import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type ProctorFlag, type ProctorSession } from '@prisma/client';
import {
  FLAG_TYPES,
  resolveFeatures,
  riskBand,
  trustBand,
  trustScore,
  type ProctorFeatures,
  type ProctorOptions,
  type DeviceInfo,
  type EvidenceDto,
  type FlagSeverity,
  type IntegrityReport,
  type PreflightResultDto,
  type ProctorFlagDto,
  type ProctorFlagInput,
  type ProctorFlagType,
  type ProctorHeartbeat,
  type ProctorMode,
  type ProctorPreflightInput,
  type ProctorSessionDetailDto,
  type ProctorSessionDto,
} from '@testwise/shared';
import type { Server } from 'socket.io';
import { AppConfigService } from '../app-config/app-config.service';
import { AttemptsService } from '../attempts/attempts.service';
import { isMinor } from '../auth/user-mapper';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { PrivateStorageService } from '../common/storage.service';
import { TokensService } from '../common/tokens.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ResultsService } from '../results/results.service';
import { AttestationService, type AttestationResult } from './attestation.service';
import { LiveKitService } from './livekit.service';

/** Holds the /proctor Socket.IO server so services can emit without a circular dependency. */
@Injectable()
export class ProctorBus {
  server: Server | null = null;
  toStudent(sessionId: string, event: string, payload: unknown) {
    this.server?.to(`s:${sessionId}`).emit(event, payload);
  }
  toAdmins(tournamentId: string | null, event: string, payload: unknown) {
    if (!this.server) return;
    const rooms = ['admins:all', ...(tournamentId ? [`admins:t:${tournamentId}`] : ['admins:practice'])];
    this.server.to(rooms).emit(event, payload);
  }
}

type Evidence = { key: string; kind: 'image' | 'audio'; mime: string };
type Blocker = PreflightResultDto['blockers'][number];
type Warning = PreflightResultDto['warnings'][number];

const sessionInclude = {
  user: { select: { id: true, displayName: true, email: true, status: true } },
  attempt: { select: { paper: true, deadlineAt: true, startedAt: true, status: true, tournament: { select: { id: true, titleEn: true, slug: true } } } },
  _count: { select: { flags: { where: { status: 'OPEN' as const } } } },
} satisfies Prisma.ProctorSessionInclude;
type SessionRow = Prisma.ProctorSessionGetPayload<{ include: typeof sessionInclude }>;

@Injectable()
export class ProctoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Proctoring');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokensService,
    private readonly storage: PrivateStorageService,
    private readonly redis: RedisService,
    private readonly attempts: AttemptsService,
    private readonly livekit: LiveKitService,
    private readonly bus: ProctorBus,
    private readonly attestation: AttestationService,
    private readonly results: ResultsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => void this.redis.withLock('job:proctor-offline', 30_000, () => this.flagOffline()).catch((e) => this.logger.error(e)), 15_000));
    this.timers.push(setInterval(() => void this.redis.withLock('job:proctor-retention', 600_000, () => this.applyRetention()).catch((e) => this.logger.error(e)), 3_600_000));
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  policy() {
    return this.config.get('proctoring.policy');
  }

  // ------------------------------------------------------------- Pre-check

  attestChallenge(userId: string) {
    return this.attestation.challenge(userId);
  }

  /** True when this install id or attested key is on the human-decided device ban list. */
  private async isDeviceBanned(hashes: (string | null)[]) {
    const list = hashes.filter((h): h is string => !!h);
    if (!list.length) return false;
    return !!(await this.prisma.bannedDevice.findFirst({ where: { deviceHash: { in: list }, liftedAt: null } }));
  }

  /** Human-readable blocker for each attestation failure reason. */
  private attestationBlockers(r: AttestationResult): Blocker[] {
    const out: Blocker[] = [];
    const has = (p: string) => r.reasons.some((x) => x === p || x.startsWith(p));
    if (r.unavailable) out.push({ code: 'ATTESTATION_UNAVAILABLE', messageEn: 'Device verification is temporarily unavailable. Try again in a few minutes.', messageHi: 'डिवाइस सत्यापन अभी उपलब्ध नहीं है। कुछ मिनट बाद दोबारा कोशिश करें।' });
    else if (has('RISKY_APP')) out.push({ code: 'RISKY_APP', messageEn: 'A screen-capture, screen-sharing, remote-control or overlay app is running. Close it, then try again.', messageHi: 'स्क्रीन कैप्चर, शेयरिंग, रिमोट-कंट्रोल या ओवरले ऐप चल रहा है। उसे बंद करके दोबारा कोशिश करें।' });
    else if (has('NOT_PLAY_RECOGNIZED') || has('SIGNING_CERT_MISMATCH') || has('PACKAGE_MISMATCH')) out.push({ code: 'APP_TAMPERED', messageEn: FLAG_TYPES.APP_TAMPERED.warnEn, messageHi: FLAG_TYPES.APP_TAMPERED.warnHi });
    else if (has('DEVICE_NOT_CERTIFIED') || has('NOT_STRONG_INTEGRITY') || has('EMULATOR')) out.push({ code: 'DEVICE_NOT_CERTIFIED', messageEn: 'This phone failed Google/Apple security checks (rooted, jailbroken, emulator, or modified software). Use an unmodified phone.', messageHi: 'यह फ़ोन Google/Apple सुरक्षा जाँच में विफल रहा (रूटेड, जेलब्रोकन, एमुलेटर या बदला हुआ सॉफ़्टवेयर)। बिना बदलाव वाला फ़ोन इस्तेमाल करें।' });
    else out.push({ code: 'ATTESTATION_FAILED', messageEn: FLAG_TYPES.ATTESTATION_FAILED.warnEn, messageHi: FLAG_TYPES.ATTESTATION_FAILED.warnHi });
    return out;
  }

  async preflight(userId: string, input: ProctorPreflightInput): Promise<PreflightResultDto> {
    const policy = await this.policy();
    let rawMode: ProctorMode;
    let ref: string;
    let options: ProctorOptions = {};
    if (input.attemptRef.tournamentSlug) {
      const t = await this.prisma.tournament.findUnique({ where: { slug: input.attemptRef.tournamentSlug } });
      if (!t) throw new NotFoundException('Tournament not found');
      const reg = await this.prisma.registration.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId } } });
      if (reg?.status !== 'CONFIRMED') throw new ForbiddenException('You are not registered for this tournament');
      rawMode = t.proctorMode;
      options = (t.proctorOptions as ProctorOptions) ?? {};
      ref = t.slug;
    } else {
      const test = await this.prisma.test.findUnique({ where: { id: input.attemptRef.testId! } });
      if (!test) throw new NotFoundException('Test not found');
      rawMode = test.proctorMode;
      options = (test.proctorOptions as ProctorOptions) ?? {};
      ref = test.id;
    }
    const mode = await this.attempts.effectiveMode(rawMode);
    if (mode === 'OFF') return { ok: true, token: null, mode, features: null, live: null, blockers: [], warnings: [] };
    const features = resolveFeatures(mode, options, policy);
    const needCamera = features.faceCheck || features.objectDetection || features.liveStream;
    const needMic = features.speech || features.liveStream;

    const blockers: Blocker[] = [];
    const warnings: Warning[] = [];
    const block = (code: string, messageEn: string, messageHi: string, packages?: Blocker['packages']) => blockers.push({ code, messageEn, messageHi, ...(packages && { packages }) });
    const warn = (code: string, messageEn: string, messageHi: string) => warnings.push({ code, messageEn, messageHi });
    const r = input.integrity;

    const [user, age] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: userId } }), this.config.get('policy.age')]);
    if ((needCamera || needMic) && !policy.allowMinors && isMinor(user, age.adultAge)) {
      block('MINOR', 'Camera-proctored tests are open to adult accounts only.', 'कैमरा निगरानी वाले टेस्ट केवल वयस्क खातों के लिए हैं।');
    }
    if (input.consentVersion !== policy.consentVersion) block('CONSENT_OUTDATED', 'The monitoring terms changed. Review and accept them again.', 'निगरानी की शर्तें बदल गई हैं। कृपया दोबारा पढ़कर स्वीकार करें।');
    if (policy.requireNativeApp && (r.platform === 'web' || !r.nativeChecks)) {
      block('NATIVE_APP_REQUIRED', 'Proctored tests need the latest Testwise app from the Play Store / App Store.', 'निगरानी वाले टेस्ट के लिए Play Store / App Store से नया Testwise ऐप चाहिए।');
    }
    if ((needCamera && !input.permissions.camera) || (needMic && !input.permissions.microphone)) {
      block('PERMISSIONS', 'Allow camera and microphone access to take this test.', 'यह टेस्ट देने के लिए कैमरा और माइक की अनुमति दें।');
    }
    // The agreement must cover exactly what this exam monitors; a missing permission is never assumed.
    const wantsScreen = features.screenShare && r.platform === 'android';
    if ((needCamera && !input.consent.camera) || (needMic && !input.consent.microphone) || (wantsScreen && !input.consent.screen)) {
      block('CONSENT_INCOMPLETE', 'You must agree to every permission this test needs: camera, microphone and screen sharing where listed.', 'इस टेस्ट के लिए ज़रूरी हर अनुमति (कैमरा, माइक और जहाँ लिखा हो वहाँ स्क्रीन शेयरिंग) पर सहमति देनी होगी।');
    }
    if (features.connectionCheck && (input.network.rttMs > policy.maxRttMs || input.network.downMbps < policy.minDownMbps)) {
      block('UNSTABLE_CONNECTION', `Your connection is too weak for a proctored test (delay ${Math.round(input.network.rttMs)} ms, speed ${input.network.downMbps.toFixed(1)} Mbps; need under ${policy.maxRttMs} ms and at least ${policy.minDownMbps} Mbps). Move closer to your router or switch networks.`, `आपका कनेक्शन निगरानी वाले टेस्ट के लिए कमज़ोर है (देरी ${Math.round(input.network.rttMs)} ms, स्पीड ${input.network.downMbps.toFixed(1)} Mbps)। राउटर के पास जाएँ या नेटवर्क बदलें।`);
    }
    if (features.liveStream && !this.livekit.isConfigured()) block('LIVE_UNAVAILABLE', 'Live proctoring is not available right now. Contact support.', 'लाइव निगरानी अभी उपलब्ध नहीं है। सपोर्ट से संपर्क करें।');
    // Only packages on the admin list count, whatever the device reports.
    const listed = new Map(policy.blockedApps.map((a) => [a.packageId, a]));
    const found = r.remoteApps.filter((a) => listed.has(a.packageId)).map((a) => ({ packageId: a.packageId, name: listed.get(a.packageId)!.name }));
    if (found.length) block('REMOTE_APPS', 'Uninstall these apps to continue. They can control or share your screen.', 'जारी रखने के लिए ये ऐप हटाएँ। ये आपकी स्क्रीन नियंत्रित या शेयर कर सकते हैं।', found);
    if (r.rooted && policy.blockRooted) block('ROOTED', FLAG_TYPES.ROOTED_DEVICE.warnEn, FLAG_TYPES.ROOTED_DEVICE.warnHi);
    if (r.emulator && policy.blockEmulator) block('EMULATOR', FLAG_TYPES.EMULATOR.warnEn, FLAG_TYPES.EMULATOR.warnHi);
    if (r.usbDebugging) (policy.blockUsbDebugging ? block : warn)('USB_DEBUGGING', FLAG_TYPES.USB_DEBUGGING.warnEn, FLAG_TYPES.USB_DEBUGGING.warnHi);
    if (r.screenCaptured) block('SCREEN_CAPTURED', FLAG_TYPES.SCREEN_RECORDING.warnEn, FLAG_TYPES.SCREEN_RECORDING.warnHi);
    if (r.externalDisplays > 0) block('EXTERNAL_DISPLAY', FLAG_TYPES.EXTERNAL_DISPLAY.warnEn, FLAG_TYPES.EXTERNAL_DISPLAY.warnHi);
    if (r.multiWindow) block('MULTI_WINDOW', FLAG_TYPES.SPLIT_SCREEN.warnEn, FLAG_TYPES.SPLIT_SCREEN.warnHi);
    const allowed = new Set(policy.accessibilityAllowlist.map((a) => a.packageId));
    const unknownA11y = r.accessibilityServices.filter((s) => !allowed.has(s.split('/')[0]));
    if (unknownA11y.length) (policy.blockUnknownAccessibility ? block : warn)('ACCESSIBILITY', FLAG_TYPES.ACCESSIBILITY_SERVICE.warnEn, FLAG_TYPES.ACCESSIBILITY_SERVICE.warnHi);
    if (needMic && r.headphones) (policy.blockHeadphones ? block : warn)('HEADPHONES', FLAG_TYPES.HEADPHONES.warnEn, FLAG_TYPES.HEADPHONES.warnHi);
    if (needCamera && !(input.faceCheck?.passed && input.faceCheck.faces === 1)) {
      block('FACE_CHECK', 'We need to see exactly one face — yours — clearly in good light.', 'हमें साफ़ रोशनी में केवल एक चेहरा — आपका — दिखना चाहिए।');
    }

    if (await this.isDeviceBanned([input.device.deviceId ? AttestationService.deviceHash('install', input.device.deviceId) : null, input.attestation?.platform === 'ios' ? AttestationService.deviceHash('key', input.attestation.keyId) : null])) {
      block('DEVICE_BANNED', 'This device is not allowed to take proctored tests. Contact support if you think this is a mistake.', 'इस डिवाइस को निगरानी वाले टेस्ट देने की अनुमति नहीं है। गलती लगे तो सपोर्ट से संपर्क करें।');
    }

    // Platform attestation: the only check a modified app or rooted phone cannot fake from inside the app.
    let attest: AttestationResult | null = null;
    if (policy.requireAttestation) {
      attest = await this.attestation.verify(userId, input.challengeId, input.attestation, policy);
      if (attest.deviceHash && (await this.isDeviceBanned([attest.deviceHash]))) block('DEVICE_BANNED', 'This device is not allowed to take proctored tests. Contact support if you think this is a mistake.', 'इस डिवाइस को निगरानी वाले टेस्ट देने की अनुमति नहीं है।');
      if (!attest.ok) {
        if (attest.unavailable && policy.attestationFailOpen) warn('ATTESTATION_UNVERIFIED', 'Device verification could not run; this attempt will be reviewed.', 'डिवाइस सत्यापन नहीं हो सका; इस प्रयास की समीक्षा होगी।');
        else {
          for (const b of this.attestationBlockers(attest)) blockers.push(b);
          this.logger.warn(`attestation blocked user ${userId}: ${attest.reasons.join(',')}`);
        }
      }
    }

    if (blockers.length) return { ok: false, token: null, mode, features, live: null, blockers, warnings };
    // The stream room is chosen now so the single consent screen can start camera + mic + screen before the attempt exists.
    const liveRoom = features.liveStream ? randomUUID() : null;
    const token = await this.tokens.signProctor({
      sub: userId, ref, mode, consentVersion: input.consentVersion, deviceId: input.device.deviceId, device: input.device, integrity: input.integrity,
      features, consent: { ...input.consent, at: new Date().toISOString() }, network: { rttMs: input.network.rttMs, downMbps: input.network.downMbps }, liveRoom,
      attestation: attest ? { level: attest.level, ok: attest.ok, unavailable: attest.unavailable, reasons: attest.reasons, riskyApps: attest.riskyApps, deviceHash: attest.deviceHash, platform: attest.platform } : null,
    });
    const live = liveRoom ? await this.livekit.studentToken(liveRoom, userId, user.displayName, 4 * 3600) : null;
    return { ok: true, token, mode, features, live: live ? { url: live.url, token: live.token } : null, blockers, warnings };
  }

  // ------------------------------------------------------------- Student side

  private async mySession(userId: string, attemptId: string) {
    const s = await this.prisma.proctorSession.findUnique({ where: { attemptId }, include: { attempt: { select: { status: true, testId: true, test: { select: { titleEn: true, titleHi: true } } } } } });
    if (!s || s.userId !== userId) throw new NotFoundException('No proctoring session for this attempt');
    return s;
  }

  async ingestFlag(userId: string, attemptId: string, input: ProctorFlagInput, files: { buffer: Buffer; mimetype: string }[]) {
    const s = await this.mySession(userId, attemptId);
    if (s.status !== 'ACTIVE' || s.attempt.status !== 'IN_PROGRESS') return { accepted: false, reason: 'session ended' };
    const n = await this.redis.incr(`proctor-flags:${s.id}`, 600);
    if (n > 150) return { accepted: false, reason: 'rate limited' };
    const evidence: Evidence[] = [];
    for (const f of files.slice(0, 2)) {
      const saved = await this.storage.save(`proctor/${s.id}`, f.mimetype, f.buffer);
      evidence.push({ key: saved.key, kind: f.mimetype.startsWith('audio') ? 'audio' : 'image', mime: saved.mime });
    }
    const flag = await this.raise(s, { type: input.type, source: 'DEVICE', confidence: input.confidence ?? null, message: input.message ?? null, details: input.details, evidence, occurredAt: input.clientAt ? new Date(input.clientAt) : new Date() });
    return { accepted: !!flag, flagId: flag?.id ?? null };
  }

  async snapshot(userId: string, attemptId: string, file: { buffer: Buffer; mimetype: string } | undefined, faces: number | null) {
    if (!file) throw new BadRequestException('No image');
    const s = await this.mySession(userId, attemptId);
    if (s.status !== 'ACTIVE') return { accepted: false };
    const n = await this.redis.incr(`proctor-snaps:${s.id}`, 60);
    if (n > 12) return { accepted: false };
    const saved = await this.storage.save(`proctor/${s.id}`, file.mimetype, file.buffer);
    await this.prisma.proctorSnapshot.create({ data: { sessionId: s.id, key: saved.key, faces } });
    const updated = await this.prisma.proctorSession.update({ where: { id: s.id }, data: { snapshotKey: saved.key, snapshotAt: new Date(), faces, lastSeenAt: new Date() } });
    this.bus.toAdmins(s.tournamentId, 'session:snapshot', { sessionId: s.id, url: this.storage.signedUrl(saved.key), faces, at: updated.snapshotAt });
    return { accepted: true };
  }

  /** Called by the gateway for each heartbeat. Detects a second device on the same attempt. */
  async heartbeat(sessionId: string, hb: ProctorHeartbeat) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s || s.status !== 'ACTIVE') return null;
    const data: Prisma.ProctorSessionUpdateInput = {
      lastSeenAt: new Date(), appState: hb.appState, questionIndex: hb.questionIndex, answered: hb.answered,
      ...(hb.faces !== null && { faces: hb.faces }),
      ...(hb.integrity && { integrity: { ...((s.integrity as object) ?? {}), ...hb.integrity } as Prisma.InputJsonValue }),
    };
    if (!s.deviceId && hb.deviceId) data.deviceId = hb.deviceId;
    const updated = await this.prisma.proctorSession.update({ where: { id: sessionId }, data });
    if (s.deviceId && hb.deviceId && hb.deviceId !== s.deviceId) {
      await this.raise(s, { type: 'MULTIPLE_DEVICES', source: 'SERVER', confidence: 1, message: null, details: {}, evidence: [] });
    }
    this.bus.toAdmins(s.tournamentId, 'session:update', { sessionId, appState: hb.appState, questionIndex: hb.questionIndex, answered: hb.answered, marked: hb.marked, faces: hb.faces, noiseLevel: hb.noiseLevel, lastSeenAt: updated.lastSeenAt });
    return updated;
  }

  async liveTokenForStudent(userId: string, attemptId: string) {
    const s = await this.mySession(userId, attemptId);
    if (s.status !== 'ACTIVE' || s.mode !== 'LIVE' || !(s.liveRequested || s.liveRoom)) throw new ConflictException('No live session requested');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const remaining = Math.max(60, Math.round((new Date((await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).deadlineAt).getTime() - Date.now()) / 1000) + 300);
    return this.livekit.studentToken(s.liveRoom ?? s.id, userId, user.displayName, remaining);
  }

  sessionForSocket(userId: string, attemptId: string) {
    return this.prisma.proctorSession.findFirst({ where: { attemptId, userId, status: 'ACTIVE' } });
  }

  /**
   * Mid-exam re-verification. The app sends a fresh integrity proof every `reattestMinutes`; a failure is a CRITICAL
   * flag (which the admin rules may turn into an automatic end of the attempt). A passing proof refreshes `attestedAt`.
   */
  async reattest(userId: string, attemptId: string, input: { challengeId?: string | null; attestation?: ProctorPreflightInput['attestation'] }) {
    const s = await this.mySession(userId, attemptId);
    if (s.status !== 'ACTIVE' || s.attempt.status !== 'IN_PROGRESS') return { ok: false, ended: true };
    const policy = await this.policy();
    if (!policy.requireAttestation) return { ok: true };
    const r = await this.attestation.verify(userId, input.challengeId, input.attestation, policy);
    if (r.ok || (r.unavailable && policy.attestationFailOpen)) {
      await this.prisma.proctorSession.update({ where: { id: s.id }, data: { attestedAt: new Date(), attestation: { level: r.level, ok: r.ok, reasons: r.reasons, riskyApps: r.riskyApps, deviceHash: r.deviceHash, platform: r.platform } } });
      return { ok: true };
    }
    if (r.unavailable) return { ok: true, deferred: true }; // our outage must not punish the student
    const risky = r.reasons.some((x) => x.startsWith('RISKY_APP'));
    await this.raise(s, {
      type: risky ? 'REMOTE_APP' : r.reasons.some((x) => x === 'NOT_PLAY_RECOGNIZED' || x === 'SIGNING_CERT_MISMATCH' || x === 'PACKAGE_MISMATCH') ? 'APP_TAMPERED' : 'ATTESTATION_FAILED',
      source: 'SERVER', confidence: 1, message: null, details: { reasons: r.reasons.slice(0, 20), packages: r.riskyApps.slice(0, 20) }, evidence: [],
    });
    return { ok: false };
  }

  /** True when the last verified proof is older than the policy allows; the heartbeat ack tells the app to send a new one. */
  async reattestDue(attestedAt: Date | null) {
    const policy = await this.policy(); // cached config; no extra query per heartbeat
    if (!policy.requireAttestation || policy.reattestMinutes <= 0) return false;
    return !attestedAt || Date.now() - attestedAt.getTime() > policy.reattestMinutes * 60_000;
  }

  /** Human decision: remove the student from the ranking (tournament) and end any active attempt. */
  async disqualify(sessionId: string, reason: string, actor: AuditActor) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId }, include: { attempt: { select: { status: true } } } });
    if (!s) throw new NotFoundException('Session not found');
    if (s.attempt.status === 'IN_PROGRESS') await this.terminate(sessionId, `Disqualified: ${reason}`, actor).catch(() => undefined);
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'DISQUALIFY', actor: actor.type === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', adminId: actor.id ?? null, message: reason } });
    let applied = false;
    if (s.tournamentId) {
      const t = await this.prisma.tournament.findUnique({ where: { id: s.tournamentId } });
      // Results can only be changed while in review; otherwise the DQ is applied when the first result version is built.
      if (t?.status === 'IN_REVIEW') {
        await this.results.act(t.id, { userId: s.userId, action: 'DISQUALIFY', reason }, actor);
        applied = true;
      }
    }
    await this.audit.log(actor, { action: 'proctor.disqualify', entityType: 'ProctorSession', entityId: sessionId, meta: { reason, applied } });
    this.bus.toAdmins(s.tournamentId, 'session:update', { sessionId, disqualified: true });
    return { ok: true, appliedToResults: applied };
  }

  /**
   * Admin-only: reopen a submitted attempt so the student can carry on (e.g. an automatic submission that was a
   * false alarm). There is no student-facing control; students ask support. The clock restarts with the time that was
   * left when it was submitted (or `minutes`), never past the tournament window, and the old score is discarded.
   */
  async reinstateAttempt(attemptId: string, input: { minutes?: number; reason: string }, actor: AuditActor) {
    if (actor.type !== 'ADMIN') throw new ForbiddenException('Only an admin can reinstate an attempt');
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { tournament: true, proctor: true } });
    if (!a) throw new NotFoundException('Attempt not found');
    if (a.status === 'IN_PROGRESS') throw new ConflictException('This attempt is already in progress');
    const now = Date.now();
    if (a.tournament && (a.tournament.status !== 'LIVE' || a.tournament.endsAt.getTime() <= now)) {
      throw new ConflictException('The tournament window has closed. Extend the tournament window first, then reinstate.');
    }
    const leftAtSubmit = a.submittedAt ? Math.max(0, a.deadlineAt.getTime() - a.submittedAt.getTime()) : 0;
    const wantedMs = (input.minutes ? input.minutes * 60_000 : Math.max(leftAtSubmit, 60_000));
    const cap = a.tournament ? a.tournament.endsAt.getTime() - now : Number.MAX_SAFE_INTEGER;
    const durationMs = Math.min(wantedMs, cap);
    if (durationMs < 30_000) throw new ConflictException('Not enough time left in the tournament window to reinstate');
    const deadlineAt = new Date(now + durationMs);
    await this.prisma.$transaction(async (tx) => {
      await tx.attempt.update({
        where: { id: a.id },
        data: { status: 'IN_PROGRESS', submittedAt: null, deadlineAt, score: null, maxScore: null, correctCount: null, wrongCount: null, skippedCount: null, accuracy: null, timeTakenSec: null },
      });
      await tx.attemptAnswer.updateMany({ where: { attemptId: a.id }, data: { isCorrect: null, marksAwarded: null } });
      if (a.proctor) {
        await tx.proctorSession.update({ where: { id: a.proctor.id }, data: { status: 'ACTIVE', endedAt: null, lastSeenAt: new Date() } });
        await tx.proctorAction.create({ data: { sessionId: a.proctor.id, userId: a.userId, type: 'REINSTATE', actor: 'ADMIN', adminId: actor.id ?? null, message: input.reason } });
      }
      await tx.attemptEvent.create({ data: { attemptId: a.id, type: 'ADMIN_REINSTATED', meta: { reason: input.reason, adminId: actor.id ?? 'unknown', minutes: Math.round(durationMs / 60_000) }, riskPoints: 0 } });
    });
    await this.audit.log(actor, { action: 'attempt.reinstate', entityType: 'Attempt', entityId: a.id, meta: { reason: input.reason, minutes: Math.round(durationMs / 60_000), userId: a.userId } });
    if (a.proctor) this.bus.toAdmins(a.tournamentId, 'session:update', { sessionId: a.proctor.id, status: 'ACTIVE' });
    return { ok: true, deadlineAt: deadlineAt.toISOString(), minutes: Math.round(durationMs / 60_000) };
  }

  /** Ban the devices behind a session (install id + attested key) from proctored tests. Reversible by a human. */
  async banDevice(sessionId: string, reason: string, actor: AuditActor) {
    if (actor.type !== 'ADMIN') throw new ForbiddenException('Only a proctor can ban a device');
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    const hashes = new Set<string>();
    if (s.deviceId) hashes.add(AttestationService.deviceHash('install', s.deviceId));
    const att = s.attestation as { deviceHash?: string | null } | null;
    if (att?.deviceHash) hashes.add(att.deviceHash);
    if (!hashes.size) throw new ConflictException('No device identifier recorded for this session');
    for (const h of hashes) {
      await this.prisma.bannedDevice.upsert({
        where: { deviceHash: h },
        create: { deviceHash: h, userId: s.userId, reason, adminId: actor.id ?? null, sessionId },
        update: { liftedAt: null, reason, adminId: actor.id ?? null, sessionId },
      });
    }
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'DEVICE_BAN', actor: 'ADMIN', adminId: actor.id ?? null, message: reason } });
    await this.audit.log(actor, { action: 'proctor.device_ban', entityType: 'ProctorSession', entityId: sessionId, meta: { reason, devices: hashes.size } });
    return { ok: true, devices: hashes.size };
  }

  bannedDevices() {
    return this.prisma.bannedDevice.findMany({ where: { liftedAt: null }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  async liftDeviceBan(id: string, actor: AuditActor) {
    const b = await this.prisma.bannedDevice.update({ where: { id }, data: { liftedAt: new Date() } });
    await this.audit.log(actor, { action: 'proctor.device_ban_lift', entityType: 'BannedDevice', entityId: id, meta: { userId: b.userId } });
    return { ok: true };
  }

  // ------------------------------------------------------------- Rules engine

  /**
   * Record a flag and apply the admin-configured rule: points, automatic warning (with a
   * per-type cooldown) and optional automatic end of the attempt. Never blocks an account.
   */
  async raise(
    s: ProctorSession,
    f: { type: ProctorFlagType; source: 'DEVICE' | 'SERVER' | 'ADMIN'; confidence: number | null; message: string | null; details: Record<string, unknown>; evidence: Evidence[]; occurredAt?: Date; severity?: FlagSeverity; adminId?: string },
  ): Promise<ProctorFlag | null> {
    const policy = await this.policy();
    const rule = policy.rules.find((r) => r.flag === f.type);
    const info = FLAG_TYPES[f.type];
    if (rule && !rule.enabled && f.source !== 'ADMIN') return null;
    const severity = f.severity ?? (rule?.severity as FlagSeverity | undefined) ?? info.severity;
    const points = f.source === 'ADMIN' ? 0 : rule?.points ?? info.points;
    const flag = await this.prisma.$transaction(async (tx) => {
      const created = await tx.proctorFlag.create({
        data: {
          sessionId: s.id, attemptId: s.attemptId, userId: s.userId, tournamentId: s.tournamentId, type: f.type, severity, source: f.source,
          confidence: f.confidence, message: f.message ?? info.labelEn, details: f.details as Prisma.InputJsonValue, evidence: f.evidence as unknown as Prisma.InputJsonValue,
          points, occurredAt: f.occurredAt ?? new Date(), ...(f.adminId && { reviewedById: f.adminId }),
        },
      });
      await tx.proctorSession.update({ where: { id: s.id }, data: { riskScore: { increment: points }, flagCount: { increment: 1 } } });
      // Mirror into the attempt's integrity ledger so the results review timeline shows it too.
      await tx.attemptEvent.create({ data: { attemptId: s.attemptId, type: 'PROCTOR_FLAG', meta: { flagId: created.id, flag: f.type, severity, source: f.source }, riskPoints: points } });
      return created;
    });
    const fresh = await this.prisma.proctorSession.findUniqueOrThrow({ where: { id: s.id } });
    this.bus.toAdmins(s.tournamentId, 'flag:new', await this.flagDto(flag, true));
    const trust = trustScore(fresh.riskScore);
    this.bus.toAdmins(s.tournamentId, 'session:update', { sessionId: s.id, riskScore: fresh.riskScore, risk: riskBand(fresh.riskScore), trust, trustBand: trustBand(trust, policy.trustReviewBelow), flagCount: fresh.flagCount });

    // Falling below the review line raises one flag for admins (the score itself is never sent to the student).
    if (f.type !== 'LOW_TRUST' && f.source !== 'ADMIN' && trust < policy.trustReviewBelow && (await this.redis.incr(`proctor-lowtrust:${s.id}`, 86_400)) === 1) {
      await this.raise(fresh, { type: 'LOW_TRUST', source: 'SERVER', confidence: 1, message: `Trust score fell to ${trust} (review below ${policy.trustReviewBelow})`, details: { reasons: [`trust ${trust}`] }, evidence: [] });
    }

    if (f.source === 'ADMIN' || fresh.status !== 'ACTIVE') return flag;

    // The only automatic submissions: the repeated-violation rules in policy.autoSubmitRules. Everything else is for an admin to decide.
    const feats = fresh.features as ProctorFeatures | null;
    const submitRule = feats?.autoSubmit ? policy.autoSubmitRules.find((r) => r.flag === f.type && (f.confidence ?? 1) >= r.minConfidence) : undefined;
    if (submitRule) {
      // After an admin reinstates the attempt the count starts again, so the very next slip does not re-submit it.
      const baseline = (await this.prisma.proctorAction.findFirst({ where: { sessionId: s.id, type: 'REINSTATE' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt;
      const count = await this.prisma.proctorFlag.count({
        where: { sessionId: s.id, type: f.type, source: { not: 'ADMIN' }, status: { not: 'DISMISSED' }, ...(baseline && { createdAt: { gt: baseline } }), OR: [{ confidence: null }, { confidence: { gte: submitRule.minConfidence } }] },
      });
      const left = submitRule.count - count;
      const what = f.type === 'APP_SWITCH' ? { en: 'You left the test app', hi: 'आपने टेस्ट ऐप छोड़ा' } : { en: info.labelEn, hi: info.labelHi };
      if (left <= 0) {
        await this.terminate(s.id, `Submitted automatically: ${what.en} ${count} times`, { type: 'SYSTEM' });
        return flag;
      }
      await this.warn(s.id, { en: `${what.en}. ${left} more time${left === 1 ? '' : 's'} and your test will be submitted automatically.`, hi: `${what.hi}। ${left} बार और होने पर आपका टेस्ट अपने आप जमा हो जाएगा।` }, { type: 'SYSTEM' }, flag.id);
      return flag;
    }

    const autoWarn = rule?.autoWarn ?? info.autoWarn;
    if (autoWarn && info.warnEn) {
      const cooldownKey = `proctor-warn:${s.id}:${f.type}`;
      const first = (await this.redis.incr(cooldownKey, Math.max(1, policy.warningCooldownSeconds))) === 1;
      if (first) await this.warn(s.id, { en: info.warnEn, hi: info.warnHi }, { type: 'SYSTEM' }, flag.id);
    }
    if (feats?.instantDisqualify && policy.instantDisqualifyFlags.includes(f.type) && (f.confidence ?? 1) >= policy.instantDisqualifyConfidence) {
      // Ends the test now and queues the disqualification; a human can reinstate it on appeal.
      await this.disqualify(s.id, `Automatic: ${info.labelEn}`, { type: 'SYSTEM' });
      return flag;
    }
    const overPoints = policy.autoTerminateAtPoints > 0 && fresh.riskScore >= policy.autoTerminateAtPoints;
    const critical = policy.autoTerminateOnCritical && severity === 'CRITICAL';
    if (overPoints || critical) {
      await this.terminate(s.id, overPoints ? `Risk score reached ${fresh.riskScore}` : `Critical flag: ${info.labelEn}`, { type: 'SYSTEM' });
    }
    return flag;
  }

  // ------------------------------------------------------------- Actions

  async warn(sessionId: string, message: string | { en: string; hi: string }, actor: AuditActor, flagId?: string) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId }, include: { attempt: { include: { test: true, tournament: true } } } });
    if (!s) throw new NotFoundException('Session not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('This attempt is no longer in progress');
    const text = typeof message === 'string' ? { en: message, hi: message } : message;
    const system = actor.type === 'SYSTEM';
    await this.prisma.$transaction([
      this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'WARN', actor: system ? 'SYSTEM' : 'ADMIN', adminId: actor.id ?? null, flagId: flagId ?? null, message: text.en } }),
      this.prisma.proctorSession.update({ where: { id: sessionId }, data: { warningCount: { increment: 1 } } }),
      this.prisma.attemptEvent.create({ data: { attemptId: s.attemptId, type: system ? 'AUTO_WARNING' : 'ADMIN_WARNING', meta: { message: text.en, flagId: flagId ?? null }, riskPoints: 0 } }),
    ]);
    const testName = { en: s.attempt.tournament?.titleEn ?? s.attempt.test.titleEn, hi: s.attempt.tournament?.titleHi ?? s.attempt.test.titleHi };
    this.bus.toStudent(sessionId, 'proctor:warning', { messageEn: text.en, messageHi: text.hi, fromProctor: !system, at: new Date().toISOString() });
    if (system) await this.notifications.event('PROCTOR_AUTO_WARNING', s.userId, { test: testName, reason: text }, { link: `/exam/${s.attemptId}` });
    else {
      await this.notifications.event('PROCTOR_WARNING', s.userId, { tournament: testName, reason: text.en }, { link: `/exam/${s.attemptId}` });
      await this.audit.log(actor, { action: 'proctor.warn', entityType: 'ProctorSession', entityId: sessionId, meta: { message: text.en } });
    }
    this.bus.toAdmins(s.tournamentId, 'action:new', { sessionId, type: 'WARN', actor: system ? 'SYSTEM' : 'ADMIN', message: text.en, at: new Date().toISOString() });
    return { ok: true };
  }

  async terminate(sessionId: string, reason: string, actor: AuditActor) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId }, include: { attempt: { include: { test: true, tournament: true } } } });
    if (!s) throw new NotFoundException('Session not found');
    if (s.attempt.status !== 'IN_PROGRESS') throw new ConflictException('This attempt has already been submitted');
    await this.attempts.submit(s.attemptId, null, true);
    await this.prisma.proctorSession.update({ where: { id: sessionId }, data: { status: 'TERMINATED', endedAt: new Date(), liveRequested: false } });
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'TERMINATE', actor: actor.type === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', adminId: actor.id ?? null, message: reason } });
    await this.prisma.attemptEvent.create({ data: { attemptId: s.attemptId, type: 'PROCTOR_TERMINATED', meta: { reason, by: actor.type }, riskPoints: 0 } });
    await this.audit.log(actor, { action: 'proctor.terminate', entityType: 'ProctorSession', entityId: sessionId, meta: { reason, attemptId: s.attemptId } });
    const testName = { en: s.attempt.tournament?.titleEn ?? s.attempt.test.titleEn, hi: s.attempt.tournament?.titleHi ?? s.attempt.test.titleHi };
    this.bus.toStudent(sessionId, 'proctor:terminated', { reason, attemptId: s.attemptId });
    await this.notifications.event('PROCTOR_TERMINATED', s.userId, { test: testName, reason }, { link: `/result/${s.attemptId}` });
    this.bus.toAdmins(s.tournamentId, 'session:update', { sessionId, status: 'TERMINATED' });
    return { ok: true };
  }

  /** Human decision only: suspend the account, end any active attempt, revoke sessions. */
  async block(sessionId: string, reason: string, actor: AuditActor) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    if (actor.type !== 'ADMIN') throw new ForbiddenException('Only a proctor can block an account');
    const active = await this.prisma.proctorSession.findMany({ where: { userId: s.userId, status: 'ACTIVE' }, select: { id: true } });
    for (const a of active) await this.terminate(a.id, `Account blocked: ${reason}`, actor).catch(() => undefined);
    await this.prisma.user.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
    await this.tokens.revokeAll('USER', s.userId);
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'BLOCK', actor: 'ADMIN', adminId: actor.id ?? null, message: reason } });
    await this.audit.log(actor, { action: 'proctor.block_user', entityType: 'User', entityId: s.userId, meta: { reason, sessionId } });
    await this.notifications.event('ACCOUNT_SUSPENDED', s.userId, { reason });
    this.bus.toAdmins(s.tournamentId, 'session:update', { sessionId, userStatus: 'SUSPENDED' });
    return { ok: true };
  }

  async reviewFlag(flagId: string, status: 'CONFIRMED' | 'DISMISSED', note: string | null | undefined, actor: AuditActor) {
    const f = await this.prisma.proctorFlag.findUnique({ where: { id: flagId } });
    if (!f) throw new NotFoundException('Flag not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.proctorFlag.update({ where: { id: flagId }, data: { status, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note ?? null } });
      // Dismissed flags stop counting towards the risk score.
      if (status === 'DISMISSED' && f.status !== 'DISMISSED') await tx.proctorSession.update({ where: { id: f.sessionId }, data: { riskScore: { decrement: f.points } } });
      if (status !== 'DISMISSED' && f.status === 'DISMISSED') await tx.proctorSession.update({ where: { id: f.sessionId }, data: { riskScore: { increment: f.points } } });
      await tx.proctorAction.create({ data: { sessionId: f.sessionId, userId: f.userId, type: status === 'CONFIRMED' ? 'FLAG_CONFIRMED' : 'FLAG_DISMISSED', actor: 'ADMIN', adminId: actor.id ?? null, flagId, message: note ?? null } });
      await this.audit.log(actor, { action: `proctor.flag_${status.toLowerCase()}`, entityType: 'ProctorFlag', entityId: flagId, meta: { note } }, tx);
    });
    return this.flagDto(await this.prisma.proctorFlag.findUniqueOrThrow({ where: { id: flagId } }), true);
  }

  async adminFlag(sessionId: string, input: { type: ProctorFlagType; message: string; severity: FlagSeverity }, actor: AuditActor) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    const flag = await this.raise(s, { type: input.type, source: 'ADMIN', confidence: null, message: input.message, details: {}, evidence: [], severity: input.severity, adminId: actor.id ?? undefined });
    await this.audit.log(actor, { action: 'proctor.flag_add', entityType: 'ProctorSession', entityId: sessionId, meta: input });
    return flag;
  }

  /** Admin evidence capture from the live view (a still from the video). */
  async adminEvidence(sessionId: string, file: { buffer: Buffer; mimetype: string } | undefined, message: string, actor: AuditActor) {
    if (!file) throw new BadRequestException('No image');
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    const saved = await this.storage.save(`proctor/${s.id}`, file.mimetype, file.buffer);
    const flag = await this.raise(s, { type: 'ADMIN_NOTE', source: 'ADMIN', confidence: null, message, details: {}, evidence: [{ key: saved.key, kind: 'image', mime: saved.mime }], adminId: actor.id ?? undefined });
    await this.audit.log(actor, { action: 'proctor.evidence_capture', entityType: 'ProctorSession', entityId: sessionId });
    return flag;
  }

  async startLive(sessionId: string, actor: AuditActor & { name?: string }) {
    const [s, policy] = await Promise.all([this.prisma.proctorSession.findUnique({ where: { id: sessionId } }), this.policy()]);
    if (!s) throw new NotFoundException('Session not found');
    if (s.status !== 'ACTIVE') throw new ConflictException('This attempt is no longer in progress');
    if (s.mode !== 'LIVE' || !policy.liveEnabled) throw new ConflictException('Live view is available only for LIVE-proctored tests');
    const token = await this.livekit.adminToken(s.liveRoom ?? s.id, actor.id!, actor.name ?? 'Proctor');
    await this.prisma.proctorSession.update({ where: { id: s.id }, data: { liveRequested: true } });
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'LIVE_VIEW', actor: 'ADMIN', adminId: actor.id ?? null } });
    await this.audit.log(actor, { action: 'proctor.live_view', entityType: 'ProctorSession', entityId: sessionId });
    this.bus.toStudent(sessionId, 'live:start', {});
    return token;
  }

  async stopLive(sessionId: string, actor: AuditActor) {
    const s = await this.prisma.proctorSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    await this.prisma.proctorSession.update({ where: { id: sessionId }, data: { liveRequested: false } });
    await this.prisma.proctorAction.create({ data: { sessionId, userId: s.userId, type: 'LIVE_END', actor: 'ADMIN', adminId: actor.id ?? null } });
    this.bus.toStudent(sessionId, 'live:stop', {});
    return { ok: true };
  }

  // ------------------------------------------------------------- Read models

  private evidenceDtos(raw: unknown): EvidenceDto[] {
    return ((raw as Evidence[]) ?? []).map((e) => ({ kind: e.kind, mime: e.mime, url: this.storage.signedUrl(e.key) }));
  }

  async flagDto(f: ProctorFlag, withUser = false): Promise<ProctorFlagDto> {
    const extra = withUser
      ? {
          user: (await this.prisma.user.findUnique({ where: { id: f.userId }, select: { id: true, displayName: true, email: true } })) ?? undefined,
          tournament: f.tournamentId ? await this.prisma.tournament.findUnique({ where: { id: f.tournamentId }, select: { id: true, titleEn: true } }) : null,
          testTitle: (await this.prisma.attempt.findUnique({ where: { id: f.attemptId }, select: { test: { select: { titleEn: true } } } }))?.test.titleEn ?? null,
        }
      : {};
    return {
      id: f.id, sessionId: f.sessionId, attemptId: f.attemptId, type: f.type as ProctorFlagType, severity: f.severity, source: f.source as ProctorFlagDto['source'],
      confidence: f.confidence, message: f.message, details: f.details as Record<string, unknown>, evidence: this.evidenceDtos(f.evidence), status: f.status,
      reviewNote: f.reviewNote, reviewedAt: f.reviewedAt?.toISOString() ?? null, occurredAt: f.occurredAt.toISOString(), ...extra,
    };
  }

  private async sessionDto(s: SessionRow, leftApp: number): Promise<ProctorSessionDto> {
    const { heartbeatSeconds, trustReviewBelow } = await this.policy();
    const total = ((s.attempt.paper as { questions?: unknown[] })?.questions ?? []).length;
    return {
      id: s.id, attemptId: s.attemptId, mode: s.mode, status: s.status, user: s.user, tournament: s.attempt.tournament,
      device: (s.device as DeviceInfo | null) ?? null, integrity: (s.integrity as Partial<IntegrityReport> | null) ?? null,
      attestation: (s.attestation as ProctorSessionDto['attestation']) ?? null,
      consent: (s.consent as ProctorSessionDto['consent']) ?? null, network: (s.network as ProctorSessionDto['network']) ?? null, features: (s.features as ProctorFeatures | null) ?? null, attestedAt: s.attestedAt?.toISOString() ?? null,
      riskScore: s.riskScore, trust: trustScore(s.riskScore), trustBand: trustBand(trustScore(s.riskScore), trustReviewBelow), leftAppCount: leftApp, risk: riskBand(s.riskScore), warningCount: s.warningCount, flagCount: s.flagCount, openFlags: s._count.flags,
      online: !!s.lastSeenAt && Date.now() - s.lastSeenAt.getTime() < heartbeatSeconds * 3000 && s.status === 'ACTIVE',
      appState: s.appState, questionIndex: s.questionIndex, answered: s.answered, totalQuestions: total, faces: s.faces,
      snapshotUrl: s.snapshotKey ? this.storage.signedUrl(s.snapshotKey) : null, snapshotAt: s.snapshotAt?.toISOString() ?? null,
      lastSeenAt: s.lastSeenAt?.toISOString() ?? null, live: s.liveRequested, startedAt: s.attempt.startedAt.toISOString(), deadlineAt: s.attempt.deadlineAt.toISOString(),
    };
  }

  async sessions(q: { tournamentId?: string; testId?: string; status?: string; practice?: boolean }) {
    const rows = await this.prisma.proctorSession.findMany({
      where: {
        ...(q.tournamentId && { tournamentId: q.tournamentId }),
        ...(q.practice && { tournamentId: null }),
        ...(q.testId && { tournamentId: null, testId: q.testId }),
        ...(q.status ? { status: q.status as ProctorSession['status'] } : { status: 'ACTIVE' }),
      },
      include: sessionInclude,
      orderBy: [{ riskScore: 'desc' }, { createdAt: 'asc' }],
      take: 1000,
    });
    const left = await this.prisma.proctorFlag.groupBy({ by: ['sessionId'], where: { sessionId: { in: rows.map((r) => r.id) }, type: 'APP_SWITCH', status: { not: 'DISMISSED' } }, _count: true });
    const leftBy = new Map(left.map((l) => [l.sessionId, l._count]));
    return Promise.all(rows.map((r) => this.sessionDto(r, leftBy.get(r.id) ?? 0)));
  }

  async session(id: string): Promise<ProctorSessionDetailDto> {
    const s = await this.prisma.proctorSession.findUnique({ where: { id }, include: sessionInclude });
    if (!s) throw new NotFoundException('Session not found');
    const [flags, actions, snaps] = await Promise.all([
      this.prisma.proctorFlag.findMany({ where: { sessionId: id }, orderBy: { occurredAt: 'desc' }, take: 300 }),
      this.prisma.proctorAction.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.proctorSnapshot.findMany({ where: { sessionId: id }, orderBy: { takenAt: 'desc' }, take: 60 }),
    ]);
    const adminIds = [...new Set(actions.map((a) => a.adminId).filter(Boolean))] as string[];
    const admins = new Map((await this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    return {
      ...(await this.sessionDto(s, await this.prisma.proctorFlag.count({ where: { sessionId: id, type: 'APP_SWITCH', status: { not: 'DISMISSED' } } }))),
      consentAt: s.consentAt.toISOString(),
      consentVersion: s.consentVersion,
      flags: await Promise.all(flags.map((f) => this.flagDto(f))),
      actions: actions.map((a) => ({ id: a.id, type: a.type, actor: a.actor as 'SYSTEM' | 'ADMIN', adminName: a.adminId ? admins.get(a.adminId) ?? null : null, message: a.message, createdAt: a.createdAt.toISOString() })),
      snapshots: snaps.map((x) => ({ url: this.storage.signedUrl(x.key), faces: x.faces, takenAt: x.takenAt.toISOString() })),
    };
  }

  async flags(q: { status?: string; severity?: string; type?: string; tournamentId?: string; testId?: string; userId?: string }) {
    const rows = await this.prisma.proctorFlag.findMany({
      where: {
        ...(q.status ? { status: q.status as ProctorFlag['status'] } : { status: 'OPEN' }),
        ...(q.severity && { severity: { in: q.severity.split(',') as FlagSeverity[] } }),
        ...(q.type && { type: q.type }),
        ...(q.tournamentId && { tournamentId: q.tournamentId }),
        ...(q.testId && { tournamentId: null, session: { testId: q.testId } }),
        ...(q.userId && { userId: q.userId }),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, displayName: true, email: true } })).map((u) => [u.id, u]));
    const tIds = [...new Set(rows.map((r) => r.tournamentId).filter(Boolean))] as string[];
    const ts = new Map((await this.prisma.tournament.findMany({ where: { id: { in: tIds } }, select: { id: true, titleEn: true } })).map((t) => [t.id, t]));
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const attemptIds = [...new Set(rows.map((r) => r.attemptId))];
    const titles = new Map((await this.prisma.attempt.findMany({ where: { id: { in: attemptIds } }, select: { id: true, test: { select: { titleEn: true } } } })).map((a) => [a.id, a.test.titleEn]));
    const dtos = await Promise.all(rows.map(async (r) => ({ ...(await this.flagDto(r)), testTitle: titles.get(r.attemptId) ?? null, user: users.get(r.userId), tournament: r.tournamentId ? ts.get(r.tournamentId) ?? null : null })));
    return dtos.sort((a, b) => order[a.severity] - order[b.severity] || b.occurredAt.localeCompare(a.occurredAt));
  }

  /** Proctored tournaments and practice tests, with live counts, for the proctoring dashboard. Listed as soon as proctoring is switched on, before any student has started. */
  async overview() {
    const now = Date.now();
    const [ts, tests] = await Promise.all([
      this.prisma.tournament.findMany({
        where: {
          proctorMode: { not: 'OFF' },
          status: { notIn: ['DRAFT', 'CANCELLED'] },
          OR: [{ status: { in: ['SCHEDULED', 'REG_OPEN', 'REG_CLOSED', 'LIVE', 'IN_REVIEW'] } }, { startsAt: { gte: new Date(now - 14 * 86_400_000) } }],
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, titleEn: true, slug: true, status: true, startsAt: true, endsAt: true, proctorMode: true, entryFeePaise: true, rewardType: true, _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } } },
      }),
      this.prisma.test.findMany({
        where: { proctorMode: { not: 'OFF' }, status: 'PUBLISHED' },
        orderBy: { titleEn: 'asc' },
        select: { id: true, titleEn: true, proctorMode: true },
        take: 200,
      }),
    ]);
    const tIds = ts.map((t) => t.id);
    const testIds = tests.map((t) => t.id);
    const counts = await this.prisma.proctorSession.groupBy({ by: ['tournamentId', 'testId', 'status'], where: { OR: [{ tournamentId: { in: tIds } }, { tournamentId: null, testId: { in: testIds } }] }, _count: true });
    const open = await this.prisma.proctorFlag.groupBy({ by: ['tournamentId', 'severity'], where: { status: 'OPEN', tournamentId: { in: tIds } }, _count: true });
    const [openTotal, critical, activeTotal] = await Promise.all([
      this.prisma.proctorFlag.count({ where: { status: 'OPEN' } }),
      this.prisma.proctorFlag.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
      this.prisma.proctorSession.count({ where: { status: 'ACTIVE' } }),
    ]);
    return {
      liveConfigured: this.livekit.isConfigured(),
      totals: { openFlags: openTotal, criticalFlags: critical, activeSessions: activeTotal },
      tournaments: ts.map((t) => ({
        ...t,
        registered: t._count.registrations,
        paidWithRewards: t.entryFeePaise > 0 && t.rewardType !== 'NONE',
        active: counts.find((c) => c.tournamentId === t.id && c.status === 'ACTIVE')?._count ?? 0,
        ended: counts.filter((c) => c.tournamentId === t.id && c.status !== 'ACTIVE').reduce((n, c) => n + c._count, 0),
        openFlags: open.filter((o) => o.tournamentId === t.id).reduce((n, o) => n + o._count, 0),
        criticalFlags: open.find((o) => o.tournamentId === t.id && o.severity === 'CRITICAL')?._count ?? 0,
      })),
      tests: tests.map((t) => ({
        ...t,
        active: counts.find((c) => !c.tournamentId && c.testId === t.id && c.status === 'ACTIVE')?._count ?? 0,
        ended: counts.filter((c) => !c.tournamentId && c.testId === t.id && c.status !== 'ACTIVE').reduce((n, c) => n + c._count, 0),
      })),
    };
  }

  // ------------------------------------------------------------- Jobs

  /** Active sessions that stopped sending heartbeats get one CONNECTION_LOST flag per gap. */
  async flagOffline() {
    const { offlineFlagSeconds } = await this.policy();
    const stale = await this.prisma.proctorSession.findMany({
      where: { status: 'ACTIVE', lastSeenAt: { lt: new Date(Date.now() - offlineFlagSeconds * 1000) }, attempt: { status: 'IN_PROGRESS' } },
      take: 500,
    });
    for (const s of stale) {
      const gapKey = `proctor-offline:${s.id}:${s.lastSeenAt?.getTime()}`;
      if ((await this.redis.incr(gapKey, 86_400)) !== 1) continue;
      await this.raise(s, { type: 'CONNECTION_LOST', source: 'SERVER', confidence: 1, message: null, details: { durationSec: Math.round((Date.now() - (s.lastSeenAt?.getTime() ?? Date.now())) / 1000) }, evidence: [] });
    }
    return stale.length;
  }

  /** Delete media past the retention period. Flag records stay (without media) for the audit trail. */
  async applyRetention() {
    const policy = await this.policy();
    const cutoff = new Date(Date.now() - policy.evidenceRetentionDays * 86_400_000);
    const confirmedCutoff = new Date(Date.now() - policy.confirmedEvidenceRetentionDays * 86_400_000);
    const snaps = await this.prisma.proctorSnapshot.findMany({ where: { takenAt: { lt: cutoff } }, take: 5000 });
    for (const x of snaps) await this.storage.remove(x.key);
    await this.prisma.proctorSnapshot.deleteMany({ where: { id: { in: snaps.map((x) => x.id) } } });
    const flags = await this.prisma.proctorFlag.findMany({
      where: { evidence: { not: [] }, OR: [{ status: { not: 'CONFIRMED' }, createdAt: { lt: cutoff } }, { status: 'CONFIRMED', createdAt: { lt: confirmedCutoff } }] },
      take: 5000,
    });
    for (const f of flags) {
      for (const e of (f.evidence as Evidence[]) ?? []) await this.storage.remove(e.key);
      await this.prisma.proctorFlag.update({ where: { id: f.id }, data: { evidence: [], details: { ...(f.details as object), evidencePurgedAt: new Date().toISOString() } } });
    }
    await this.prisma.proctorSession.updateMany({ where: { snapshotAt: { lt: cutoff } }, data: { snapshotKey: null } });
    return { snapshots: snaps.length, flags: flags.length };
  }
}
