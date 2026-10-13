import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Attempt, type ProctorSession } from '@prisma/client';
import type { AttemptPaperDto, AttemptResultDto, QuestionReview, SaveAnswersInput, TestCardDto } from '@testwise/shared';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../app-config/app-config.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../common/prisma.service';
import { TtlCache } from '../common/ttl-cache';
import { TokensService } from '../common/tokens.service';
import { XpService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveFeatures, type ProctorFeatures, type ProctorOptions } from '@testwise/shared';
import { scorePaper, seededShuffle, type FrozenPaper, type PaperKeyQuestion } from './scoring';

const FINISHED = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;

@Injectable()
export class AttemptsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttemptsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly xp: XpService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
    private readonly tokens: TokensService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.redis.withLock('job:auto-submit', 60_000, () => this.autoSubmitDue()).catch((e) => this.logger.error(e)), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------- Paper

  /**
   * The test content is identical for every student; only the shuffle differs. When a tournament opens, thousands of
   * students start within seconds, so the 5-level read is shared (single-flight) for a few seconds. The tree is only
   * read, never mutated (seededShuffle copies).
   */
  private readonly testTrees = new TtlCache(10_000, 100);
  private loadTestTree(testId: string) {
    return this.testTrees.get(testId, () =>
      this.prisma.test.findUniqueOrThrow({
        where: { id: testId },
        include: {
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: { questions: { orderBy: { sortOrder: 'asc' }, include: { question: { include: { options: { orderBy: { sortOrder: 'asc' } } } } } } },
          },
        },
      }),
    );
  }

  private async freezePaper(testId: string, seed: string): Promise<FrozenPaper & { test: { shuffleQuestions: boolean } }> {
    const test = await this.loadTestTree(testId);
    const sections = test.sections.map((s) => ({ id: s.id, titleEn: s.titleEn, titleHi: s.titleHi }));
    const questions: PaperKeyQuestion[] = [];
    for (const s of test.sections) {
      const qs = test.shuffleQuestions ? seededShuffle(s.questions, `${seed}:${s.id}`) : s.questions;
      for (const tq of qs) {
        const q = tq.question;
        const options = q.options.map((o) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi }));
        questions.push({
          id: q.id,
          sectionId: s.id,
          type: q.type,
          textEn: q.textEn,
          textHi: q.textHi,
          imageUrl: q.imageUrl,
          options: test.shuffleOptions ? seededShuffle(options, `${seed}:${q.id}`) : options,
          marks: tq.marks ?? q.marks,
          negativeMarks: tq.negativeMarks ?? q.negativeMarks,
          correctLabels: q.correctLabels,
          correctNumeric: q.correctNumeric,
          numericTolerance: q.numericTolerance,
          solutionEn: q.solutionEn,
          solutionHi: q.solutionHi,
        });
      }
    }
    if (!questions.length) throw new ConflictException('This test has no questions yet');
    return { sections, questions, test: { shuffleQuestions: test.shuffleQuestions } };
  }

  async paperDto(attemptId: string, userId: string): Promise<AttemptPaperDto> {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { test: true, answers: true, proctor: true } });
    if (!a || a.userId !== userId) throw new NotFoundException('Attempt not found');
    return this.buildPaperDto(a, a.test, a.answers, a.proctor);
  }

  /** The student-facing paper (answer keys stripped), built from data the caller already holds. */
  private buildPaperDto(
    a: Attempt,
    test: { titleEn: string; titleHi: string | null; instructionsEn: string | null; instructionsHi: string | null; allowLanguageSwitch: boolean },
    answers: { questionId: string; selectedLabels: string[]; numericValue: number | null; markedForReview: boolean; timeSpentSec: number }[],
    proctor: Pick<ProctorSession, 'mode' | 'status' | 'liveRequested' | 'features'> | null,
  ): AttemptPaperDto {
    const paper = a.paper as unknown as FrozenPaper;
    return {
      attemptId: a.id,
      testId: a.testId,
      tournamentId: a.tournamentId,
      titleEn: test.titleEn,
      titleHi: test.titleHi,
      instructionsEn: test.instructionsEn,
      instructionsHi: test.instructionsHi,
      status: a.status,
      language: a.language,
      allowLanguageSwitch: test.allowLanguageSwitch,
      startedAt: a.startedAt.toISOString(),
      deadlineAt: a.deadlineAt.toISOString(),
      serverNow: new Date().toISOString(),
      sections: paper.sections,
      // Strip answer keys and solutions.
      questions: paper.questions.map(({ correctLabels: _c, correctNumeric: _n, numericTolerance: _t, solutionEn: _se, solutionHi: _sh, ...q }) => q),
      answers: answers.map((x) => ({
        questionId: x.questionId, selectedLabels: x.selectedLabels, numericValue: x.numericValue, markedForReview: x.markedForReview, timeSpentSec: x.timeSpentSec,
      })),
      proctor: proctor && proctor.mode !== 'OFF' ? { mode: proctor.mode, status: proctor.status, liveRequested: proctor.liveRequested, features: (proctor.features as ProctorFeatures | null) ?? null } : null,
    };
  }

  // ------------------------------------------------------------- Access

  /** Practice access: the test must be in a published series the student is enrolled in, or a free preview. */
  async practiceAccess(userId: string, testId: string) {
    const links = await this.prisma.seriesTest.findMany({
      where: { testId, series: { status: 'PUBLISHED' } },
      include: { series: { include: { enrollments: { where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } } } } },
    });
    return links.some((l) => l.freePreview || l.series.enrollments.length > 0 || l.series.pricePaise === 0);
  }

  private async create(userId: string, testId: string, tournamentId: string | null, deadline: Date, attemptNo: number, language: 'EN' | 'HI') {
    const seed = randomUUID();
    const { test: _t, ...paper } = await this.freezePaper(testId, seed);
    try {
      // `omit`: Prisma would otherwise return (and re-parse) the whole paper JSON we just wrote; we already hold it.
      const row = await this.prisma.attempt.create({
        data: { userId, testId, tournamentId, attemptNo, deadlineAt: deadline, language, paper: paper as unknown as Prisma.InputJsonValue },
        omit: { paper: true },
      });
      this.papers.set(row.id, paper);
      return { ...row, paper } as unknown as Attempt;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Attempt already started');
      throw e;
    }
  }

  // ------------------------------------------------------------- Proctoring gate

  /** Effective proctoring mode: the tournament's (or test's) mode, unless proctoring is switched off globally. */
  async effectiveMode(mode: 'OFF' | 'BASIC' | 'AI' | 'LIVE') {
    if (mode === 'OFF') return 'OFF' as const;
    const policy = await this.config.get('proctoring.policy');
    if (!policy.enabled) return 'OFF' as const;
    if (mode === 'LIVE' && !policy.liveEnabled) return 'AI' as const;
    return mode;
  }

  /**
   * AI and LIVE modes need a fresh clearance from the device pre-check (consent, permissions,
   * no blocked apps). BASIC needs none. Returns the session fields to record.
   */
  private async clearance(userId: string, ref: string, mode: 'OFF' | 'BASIC' | 'AI' | 'LIVE', options: unknown, token?: string | null) {
    if (mode === 'OFF') return null;
    // BASIC needs no camera consent, but device attestation (when required) still gates the start; there is no token-free path then.
    const policy = await this.config.get('proctoring.policy');
    const features = resolveFeatures(mode, (options as ProctorOptions) ?? {}, policy);
    if (mode === 'BASIC' && !token && !policy.requireAttestation) return { mode, consentVersion: 'basic', deviceId: null, device: null, integrity: null, attestation: null, consent: null, network: null, liveRoom: null, features };
    if (!token) throw new ForbiddenException({ message: 'This test is proctored. Complete the device check first.', code: 'PROCTOR_CHECK_REQUIRED', mode, features });
    const c = await this.tokens.verifyProctor(token);
    if (c.sub !== userId || c.ref !== ref) throw new ForbiddenException('This device check was for a different test');
    return { mode, consentVersion: c.consentVersion, deviceId: c.deviceId, device: c.device, integrity: c.integrity, attestation: c.attestation ?? null, consent: c.consent ?? null, network: c.network ?? null, liveRoom: c.liveRoom ?? null, features: c.features ?? null };
  }

  private async openSession(a: Attempt, c: NonNullable<Awaited<ReturnType<AttemptsService['clearance']>>>) {
    const json = (v: unknown) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));
    await this.prisma.proctorSession.upsert({
      where: { attemptId: a.id },
      create: {
        attemptId: a.id, userId: a.userId, tournamentId: a.tournamentId, testId: a.testId, mode: c.mode, consentAt: new Date(), consentVersion: c.consentVersion,
        deviceId: c.deviceId, device: json(c.device), integrity: json(c.integrity), lastSeenAt: new Date(),
        attestation: json(c.attestation), attestedAt: c.attestation ? new Date() : null,
        consent: json(c.consent), network: json(c.network), liveRoom: c.liveRoom ?? null, features: json(c.features),
      },
      // Resuming (e.g. after an app restart) refreshes the device report; a different device is flagged by the proctor gateway.
      update: { status: 'ACTIVE', ...(c.integrity != null && { integrity: json(c.integrity) }), ...(c.device != null && { device: json(c.device) }), ...(c.attestation != null && { attestation: json(c.attestation), attestedAt: new Date() }), ...(c.liveRoom && { liveRoom: c.liveRoom }), ...(c.features != null && { features: json(c.features) }) },
    });
  }

  async startPractice(userId: string, testId: string, proctorToken?: string | null) {
    const test = await this.prisma.test.findUnique({ where: { id: testId } });
    if (!test || test.status !== 'PUBLISHED') throw new NotFoundException('Test not available');
    if (!(await this.practiceAccess(userId, testId))) throw new ForbiddenException('Enroll in a test series that includes this test');
    const clearance = await this.clearance(userId, testId, await this.effectiveMode(test.proctorMode), test.proctorOptions, proctorToken);
    const open = await this.prisma.attempt.findFirst({ where: { userId, testId, tournamentId: null, status: 'IN_PROGRESS' } });
    if (open) {
      if (open.deadlineAt > new Date()) {
        if (clearance) await this.openSession(open, clearance);
        return this.paperDto(open.id, userId);
      }
      await this.submit(open.id, userId, true);
    }
    const used = await this.prisma.attempt.count({ where: { userId, testId, tournamentId: null } });
    if (used >= test.maxAttempts) throw new ConflictException(`You have used all ${test.maxAttempts} attempt(s) for this test`);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const a = await this.create(userId, testId, null, new Date(Date.now() + test.durationMinutes * 60_000), used + 1, user.language);
    if (clearance) await this.openSession(a, clearance);
    const proctor = clearance ? await this.prisma.proctorSession.findUnique({ where: { attemptId: a.id } }) : null;
    return this.buildPaperDto(a, test, [], proctor);
  }

  async startTournament(userId: string, slug: string, proctorToken?: string | null) {
    const t = await this.prisma.tournament.findUnique({ where: { slug }, include: { test: true } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status !== 'LIVE') throw new ConflictException('This tournament is not live');
    if (!t.test) throw new ConflictException('No test attached');
    const reg = await this.prisma.registration.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId } } });
    if (reg?.status !== 'CONFIRMED') throw new ForbiddenException('You are not registered for this tournament');
    const existing = await this.prisma.attempt.findFirst({ where: { userId, tournamentId: t.id } });
    if (existing && existing.status !== 'IN_PROGRESS') throw new ConflictException('You have already submitted this test');
    const clearance = await this.clearance(userId, slug, await this.effectiveMode(t.proctorMode), t.proctorOptions, proctorToken);
    if (existing) {
      if (clearance) await this.openSession(existing, clearance);
      return this.paperDto(existing.id, userId);
    }
    const now = Date.now();
    if (now >= t.endsAt.getTime()) throw new ConflictException('The test window has closed');
    const deadline = new Date(Math.min(now + t.durationMinutes * 60_000, t.endsAt.getTime()));
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.registration.update({ where: { id: reg.id }, data: { checkedInAt: reg.checkedInAt ?? new Date() } });
    const a = await this.create(userId, t.test.id, t.id, deadline, 1, user.language);
    if (clearance) await this.openSession(a, clearance);
    const proctor = clearance ? await this.prisma.proctorSession.findUnique({ where: { attemptId: a.id } }) : null;
    return this.buildPaperDto(a, t.test, [], proctor);
  }

  // ------------------------------------------------------------- Answers

  /** A frozen paper never changes after the attempt starts, so it is safe to keep in memory; saves would otherwise re-read and re-parse it every ~15 s per student. */
  private readonly papers = new TtlCache(10 * 60_000, 1500);
  private paperOf(attemptId: string) {
    return this.papers.get(attemptId, async () => {
      const row = await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, select: { paper: true } });
      return row.paper as unknown as FrozenPaper;
    });
  }

  private async ownedOpen(attemptId: string, userId: string) {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, omit: { paper: true } });
    if (!a || a.userId !== userId) throw new NotFoundException('Attempt not found');
    if (a.status !== 'IN_PROGRESS') throw new ConflictException('This attempt has been submitted');
    const { gracePeriodSeconds } = await this.config.get('exam.integrity');
    if (Date.now() > a.deadlineAt.getTime() + gracePeriodSeconds * 1000) {
      await this.submit(a.id, userId, true);
      throw new ConflictException('Time is up. Your answers were submitted.');
    }
    return a;
  }

  async saveAnswers(attemptId: string, userId: string, input: SaveAnswersInput) {
    const a = await this.ownedOpen(attemptId, userId);
    const paper = await this.paperOf(attemptId);
    const valid = new Map(paper.questions.map((q) => [q.id, q]));
    const rows: Prisma.Sql[] = [];
    const seen = new Set<string>();
    for (const ans of input.answers) {
      const q = valid.get(ans.questionId);
      if (!q || seen.has(ans.questionId)) continue; // a repeated question in one request would make the multi-row upsert ambiguous: last write wins below
      seen.add(ans.questionId);
      const last = [...input.answers].reverse().find((x) => x.questionId === ans.questionId)!;
      const labels = q.type === 'NUMERIC' ? [] : last.selectedLabels.filter((l) => q.options.some((o) => o.label === l));
      const numeric = q.type === 'NUMERIC' ? last.numericValue ?? null : null;
      // changeCount on first insert mirrors the old logic (counts as a change only when something is selected).
      const firstChange = labels.length > 0 || numeric != null ? 1 : 0;
      rows.push(Prisma.sql`(${'c' + randomUUID().replace(/-/g, '')}, ${attemptId}, ${ans.questionId}, ${labels}::text[], ${numeric}::double precision, ${last.markedForReview}::boolean, ${last.timeSpentSec}::int, ${firstChange}::int)`);
    }
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (rows.length) {
      // One atomic statement for the whole autosave (was: read all answers, then N upserts in a transaction).
      ops.push(this.prisma.$executeRaw`
        INSERT INTO "AttemptAnswer" ("id", "attemptId", "questionId", "selectedLabels", "numericValue", "markedForReview", "timeSpentSec", "changeCount", "updatedAt")
        SELECT v.id, v.aid, v.qid, v.labels, v.num, v.mark, v.secs, v.chg, NOW()
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, aid, qid, labels, num, mark, secs, chg)
        ON CONFLICT ("attemptId", "questionId") DO UPDATE SET
          "selectedLabels" = EXCLUDED."selectedLabels",
          "numericValue" = EXCLUDED."numericValue",
          "markedForReview" = EXCLUDED."markedForReview",
          "timeSpentSec" = GREATEST("AttemptAnswer"."timeSpentSec", EXCLUDED."timeSpentSec"),
          "changeCount" = "AttemptAnswer"."changeCount" + CASE
            WHEN "AttemptAnswer"."selectedLabels" IS DISTINCT FROM EXCLUDED."selectedLabels"
              OR "AttemptAnswer"."numericValue" IS DISTINCT FROM EXCLUDED."numericValue" THEN 1 ELSE 0 END,
          "updatedAt" = NOW()`);
    }
    if (input.language && input.language !== a.language) {
      ops.push(this.prisma.attempt.update({ where: { id: attemptId }, data: { language: input.language } }));
      ops.push(this.prisma.attemptEvent.create({ data: { attemptId, type: 'LANGUAGE_SWITCH', meta: { to: input.language } } }));
    }
    if (ops.length === 1) await ops[0];
    else if (ops.length) await this.prisma.$transaction(ops);
    return { saved: input.answers.length, serverNow: new Date().toISOString(), deadlineAt: a.deadlineAt.toISOString() };
  }

  async logEvent(
    attemptId: string,
    userId: string,
    event: {
      type: string;
      clientSessionId?: string;
      eventId?: string;
      sequence?: number;
      clientAt?: string;
      platform?: 'android' | 'ios' | 'web';
      appVersion?: string | null;
      osVersion?: string | null;
      deviceModel?: string | null;
      meta?: { to?: 'EN' | 'HI'; enabled?: boolean; signal?: string; confidence?: number };
    },
  ) {
    const a = await this.ownedOpen(attemptId, userId);
    const riskPoints: Record<string, number> = {
      APP_BACKGROUND: 3,
      OFFLINE: 1,
      SCREEN_CAPTURE_STATE: event.meta?.enabled === true ? 5 : 0,
      SCREENSHOT_TAKEN: 8,
      CAMERA_SIGNAL: event.meta?.signal === 'MULTIPLE_FACES' ? Math.round(8 * Number(event.meta?.confidence ?? 0)) : event.meta?.signal === 'FACE_MISSING' ? Math.round(2 * Number(event.meta?.confidence ?? 0)) : 0,
      MIC_SIGNAL: event.meta?.signal === 'ANSWER_SPOKEN' ? Math.round(8 * Number(event.meta?.confidence ?? 0)) : event.meta?.signal === 'VOICE_DETECTED' ? Math.round(2 * Number(event.meta?.confidence ?? 0)) : 0,
      DEVICE_CHECK: 1,
    };
    try {
      await this.prisma.attemptEvent.create({
        data: {
          attemptId,
          type: event.type,
          meta: (event.meta ?? {}) as Prisma.InputJsonValue,
          clientSessionId: event.clientSessionId ?? null,
          eventId: event.eventId ?? null,
          sequence: event.sequence ?? null,
          clientAt: event.clientAt ? new Date(event.clientAt) : null,
          platform: event.platform ?? null,
          appVersion: event.appVersion ?? null,
          osVersion: event.osVersion ?? null,
          deviceModel: event.deviceModel ?? null,
          riskPoints: riskPoints[event.type] ?? 0,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && (event.eventId || event.sequence !== undefined)) {
        return { accepted: true, duplicate: true, autoSubmitted: false };
      }
      throw e;
    }
    if (event.type === 'APP_BACKGROUND') {
      const { autoSubmitAfterBackgroundCount } = await this.config.get('exam.integrity');
      if (autoSubmitAfterBackgroundCount > 0) {
        const n = await this.prisma.attemptEvent.count({ where: { attemptId, type: 'APP_BACKGROUND' } });
        if (n >= autoSubmitAfterBackgroundCount) {
          await this.submit(a.id, userId, true);
          return { autoSubmitted: true, backgroundCount: n };
        }
        return { autoSubmitted: false, backgroundCount: n, limit: autoSubmitAfterBackgroundCount };
      }
    }
    return { accepted: true, duplicate: false, autoSubmitted: false };
  }

  // ------------------------------------------------------------- Submit & score

  /** Score server-side and close the attempt. Idempotent. */
  async submit(attemptId: string, userId: string | null, auto = false): Promise<Omit<Attempt, 'paper'>> {
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { answers: true }, omit: { paper: true } });
    if (!a || (userId && a.userId !== userId)) throw new NotFoundException('Attempt not found');
    if (a.status !== 'IN_PROGRESS') return a;
    const { multiSelectScoring } = await this.config.get('results.policy');
    const paper = await this.paperOf(attemptId);
    const result = scorePaper(paper, a.answers, multiSelectScoring);
    const now = new Date();
    const end = now < a.deadlineAt ? now : a.deadlineAt;
    const timeTakenSec = Math.max(0, Math.round((end.getTime() - a.startedAt.getTime()) / 1000));
    const byQ = new Map(result.perQuestion.map((p) => [p.questionId, p]));

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.attempt.updateMany({
        where: { id: a.id, status: 'IN_PROGRESS' },
        data: {
          status: auto ? 'AUTO_SUBMITTED' : 'SUBMITTED',
          submittedAt: now,
          score: result.score,
          maxScore: result.maxScore,
          correctCount: result.correct,
          wrongCount: result.wrong,
          skippedCount: result.skipped,
          accuracy: result.accuracy,
          timeTakenSec,
        },
      });
      if (!res.count) return null; // submitted concurrently
      await tx.proctorSession.updateMany({ where: { attemptId: a.id, status: 'ACTIVE' }, data: { status: 'ENDED', endedAt: now, liveRequested: false } });
      // One statement for all answers (a per-answer UPDATE loop held a pooled connection for ~N round trips per submit).
      const graded = a.answers.flatMap((ans) => {
        const s = byQ.get(ans.questionId);
        return s ? [Prisma.sql`(${ans.id}, ${s.isCorrect}::boolean, ${s.marksAwarded}::double precision)`] : [];
      });
      if (graded.length) {
        await tx.$executeRaw`UPDATE "AttemptAnswer" AS t SET "isCorrect" = v.ic, "marksAwarded" = v.m, "updatedAt" = NOW()
          FROM (VALUES ${Prisma.join(graded)}) AS v(id, ic, m) WHERE t.id = v.id`;
      }
      const xp = await this.config.get('gamification.xp');
      await this.xp.award(a.userId, xp.perTestCompleted, 'test', a.id, tx);
      await this.xp.award(a.userId, xp.perCorrectAnswer * result.correct, 'correct', a.id, tx);
      return tx.attempt.findUniqueOrThrow({ where: { id: a.id }, omit: { paper: true } });
    });
    if (updated) {
      const test = await this.prisma.test.findUnique({ where: { id: a.testId }, select: { titleEn: true, titleHi: true } });
      const name = { en: test?.titleEn ?? 'your test', hi: test?.titleHi ?? test?.titleEn ?? 'आपका टेस्ट' };
      if (auto) await this.notifications.event('ATTEMPT_AUTO_SUBMITTED', a.userId, { test: name }, { link: `/result/${a.id}` });
      else if (!a.tournamentId) await this.notifications.event('TEST_RESULT_READY', a.userId, { test: name, score: `${result.score}/${result.maxScore}` }, { link: `/result/${a.id}` });
    }
    return updated ?? (await this.prisma.attempt.findUniqueOrThrow({ where: { id: a.id }, omit: { paper: true } }));
  }

  async autoSubmitDue(where: Prisma.AttemptWhereInput = {}) {
    const { gracePeriodSeconds } = await this.config.get('exam.integrity');
    const due = await this.prisma.attempt.findMany({
      where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(Date.now() - gracePeriodSeconds * 1000) }, ...where },
      select: { id: true },
      take: 500,
    });
    for (const { id } of due) await this.submit(id, null, true);
    return due.length;
  }

  /** Force-submit every open attempt of a tournament (used when the window ends). */
  async closeTournament(tournamentId: string) {
    const open = await this.prisma.attempt.findMany({ where: { tournamentId, status: 'IN_PROGRESS' }, select: { id: true } });
    for (const { id } of open) await this.submit(id, null, true);
    return open.length;
  }

  // ------------------------------------------------------------- Results

  private keyRelease(a: Omit<Attempt, 'paper'> & { tournament: { status: string; endsAt: Date } | null }, policy: string): { released: boolean; en: string | null; hi: string | null } {
    if (policy === 'NEVER') return { released: false, en: 'Solutions are not published for this test.', hi: 'इस टेस्ट के समाधान प्रकाशित नहीं किए जाते।' };
    if (!a.tournament || policy === 'ON_SUBMIT') return { released: true, en: null, hi: null };
    if (policy === 'AFTER_WINDOW') {
      return a.tournament.endsAt <= new Date()
        ? { released: true, en: null, hi: null }
        : { released: false, en: 'Answer key unlocks when the test window closes.', hi: 'टेस्ट विंडो बंद होने पर उत्तर कुंजी खुलेगी।' };
    }
    return ['FINAL', 'REWARDS_APPROVED', 'CLOSED'].includes(a.tournament.status)
      ? { released: true, en: null, hi: null }
      : { released: false, en: 'Answer key unlocks when results are final.', hi: 'परिणाम अंतिम होने पर उत्तर कुंजी खुलेगी।' };
  }

  async result(attemptId: string, userId: string): Promise<AttemptResultDto> {
    const a = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { test: true, answers: true, tournament: { select: { status: true, endsAt: true, slug: true } } },
      omit: { paper: true },
    });
    if (!a || a.userId !== userId) throw new NotFoundException('Attempt not found');
    if (a.status === 'IN_PROGRESS') throw new ConflictException('Submit the test to see your result');
    const paper = await this.paperOf(attemptId);
    const { multiSelectScoring } = await this.config.get('results.policy');
    const scored = scorePaper(paper, a.answers, multiSelectScoring);
    const release = this.keyRelease(a, a.test.answerKeyPolicy);
    const byQ = new Map(a.answers.map((x) => [x.questionId, x]));
    const per = new Map(scored.perQuestion.map((p) => [p.questionId, p]));
    const review: QuestionReview[] | null = release.released
      ? paper.questions.map((q) => {
          const ans = byQ.get(q.id);
          const s = per.get(q.id)!;
          const { numericTolerance: _t, ...rest } = q;
          return {
            ...rest,
            selectedLabels: ans?.selectedLabels ?? [],
            numericValue: ans?.numericValue ?? null,
            isCorrect: s.isCorrect,
            marksAwarded: s.marksAwarded,
            correctLabels: q.correctLabels,
            correctNumeric: q.correctNumeric,
          };
        })
      : null;
    const xp = await this.prisma.xpEvent.aggregate({ where: { userId, refId: a.id }, _sum: { amount: true } });
    return {
      attemptId: a.id,
      testId: a.testId,
      tournamentId: a.tournamentId,
      tournamentSlug: a.tournament?.slug ?? null,
      titleEn: a.test.titleEn,
      titleHi: a.test.titleHi,
      status: a.status,
      submittedAt: a.submittedAt?.toISOString() ?? null,
      score: a.score ?? scored.score,
      maxScore: a.maxScore ?? scored.maxScore,
      correct: a.correctCount ?? scored.correct,
      wrong: a.wrongCount ?? scored.wrong,
      skipped: a.skippedCount ?? scored.skipped,
      accuracy: a.accuracy ?? scored.accuracy,
      timeTakenSec: a.timeTakenSec ?? 0,
      sections: scored.sections,
      review,
      answerKeyMessageEn: release.en,
      answerKeyMessageHi: release.hi,
      xpEarned: xp._sum.amount ?? 0,
    };
  }

  /** Test cards for a series or a list of tests, with the student's attempt state. */
  async testCards(userId: string, links: { testId: string; freePreview: boolean }[], enrolled: boolean): Promise<TestCardDto[]> {
    const ids = links.map((l) => l.testId);
    const [tests, attempts] = await Promise.all([
      this.prisma.test.findMany({ where: { id: { in: ids }, status: 'PUBLISHED' }, include: { questions: { include: { question: { select: { marks: true } } } } } }),
      this.prisma.attempt.findMany({ where: { userId, testId: { in: ids }, tournamentId: null }, orderBy: { startedAt: 'desc' } }),
    ]);
    const byId = new Map(tests.map((t) => [t.id, t]));
    return links
      .filter((l) => byId.has(l.testId))
      .map((l) => {
        const t = byId.get(l.testId)!;
        const mine = attempts.filter((x) => x.testId === t.id);
        const open = mine.find((x) => x.status === 'IN_PROGRESS' && x.deadlineAt > new Date());
        const last = mine.find((x) => (FINISHED as readonly string[]).includes(x.status));
        return {
          id: t.id,
          titleEn: t.titleEn,
          titleHi: t.titleHi,
          kind: t.kind,
          durationMinutes: t.durationMinutes,
          questionCount: t.questions.length,
          totalMarks: t.questions.reduce((s, q) => s + (q.marks ?? q.question.marks), 0),
          maxAttempts: t.maxAttempts,
          attemptsUsed: mine.length,
          locked: !enrolled && !l.freePreview,
          freePreview: l.freePreview,
          inProgressAttemptId: open?.id ?? null,
          lastAttempt: last ? { id: last.id, score: last.score, maxScore: last.maxScore, submittedAt: last.submittedAt?.toISOString() ?? null } : null,
        };
      });
  }

  async history(userId: string) {
    const rows = await this.prisma.attempt.findMany({
      where: { userId, status: { in: [...FINISHED] } },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      include: { test: { select: { titleEn: true, titleHi: true } }, tournament: { select: { slug: true, titleEn: true, titleHi: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      titleEn: r.tournament?.titleEn ?? r.test.titleEn,
      titleHi: r.tournament?.titleHi ?? r.test.titleHi,
      tournamentSlug: r.tournament?.slug ?? null,
      score: r.score,
      maxScore: r.maxScore,
      accuracy: r.accuracy,
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
  }

  /** Aggregate performance for the Analysis view. */
  async analytics(userId: string) {
    const attempts = await this.prisma.attempt.findMany({ where: { userId, status: { in: [...FINISHED] } }, select: { id: true, paper: true, accuracy: true, score: true, maxScore: true, submittedAt: true } });
    const answers = await this.prisma.attemptAnswer.findMany({ where: { attempt: { userId, status: { in: [...FINISHED] } } }, select: { attemptId: true, questionId: true, isCorrect: true } });
    const qIds = [...new Set(answers.map((a) => a.questionId))];
    const qs = await this.prisma.question.findMany({ where: { id: { in: qIds } }, select: { id: true, subject: { select: { id: true, nameEn: true, nameHi: true } } } });
    const subj = new Map(qs.map((q) => [q.id, q.subject]));
    const bySubject = new Map<string, { nameEn: string; nameHi: string | null; correct: number; attempted: number }>();
    for (const a of answers) {
      if (a.isCorrect == null) continue;
      const s = subj.get(a.questionId);
      if (!s) continue;
      const row = bySubject.get(s.id) ?? { nameEn: s.nameEn, nameHi: s.nameHi, correct: 0, attempted: 0 };
      row.attempted++;
      if (a.isCorrect) row.correct++;
      bySubject.set(s.id, row);
    }
    const totalAttempted = [...bySubject.values()].reduce((t, s) => t + s.attempted, 0);
    const totalCorrect = [...bySubject.values()].reduce((t, s) => t + s.correct, 0);
    return {
      testsTaken: attempts.length,
      averageAccuracy: totalAttempted ? Math.round((totalCorrect / totalAttempted) * 1000) / 10 : 0,
      questionsAnswered: totalAttempted,
      subjects: [...bySubject.entries()].map(([id, s]) => ({ id, ...s, accuracy: s.attempted ? Math.round((s.correct / s.attempted) * 1000) / 10 : 0 })).sort((a, b) => a.accuracy - b.accuracy),
      trend: attempts
        .filter((a) => a.submittedAt)
        .sort((a, b) => a.submittedAt!.getTime() - b.submittedAt!.getTime())
        .slice(-10)
        .map((a) => ({ attemptId: a.id, percent: a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 1000) / 10 : 0, submittedAt: a.submittedAt!.toISOString() })),
    };
  }

  /** Wrong answers for the revision notebook. */
  async mistakes(userId: string) {
    const wrong = await this.prisma.attemptAnswer.findMany({
      where: { isCorrect: false, attempt: { userId, status: { in: [...FINISHED] } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { attempt: { select: { id: true, paper: true, test: { select: { answerKeyPolicy: true } }, tournament: { select: { status: true, endsAt: true } } } } },
    });
    const out: (QuestionReview & { attemptId: string })[] = [];
    const seen = new Set<string>();
    for (const w of wrong) {
      if (seen.has(w.questionId)) continue;
      const policy = w.attempt.test.answerKeyPolicy;
      const release = this.keyRelease({ ...(w.attempt as unknown as Attempt), tournament: w.attempt.tournament }, policy);
      if (!release.released) continue;
      const q = (w.attempt.paper as unknown as FrozenPaper).questions.find((x) => x.id === w.questionId);
      if (!q) continue;
      seen.add(w.questionId);
      const { numericTolerance: _t, ...rest } = q;
      out.push({
        ...rest, attemptId: w.attempt.id, selectedLabels: w.selectedLabels, numericValue: w.numericValue, isCorrect: false,
        marksAwarded: w.marksAwarded ?? 0, correctLabels: q.correctLabels, correctNumeric: q.correctNumeric,
      });
    }
    return out;
  }
}
