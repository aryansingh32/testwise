import { createHash, createPublicKey, createSign, createVerify, randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AttestationEvidence, ConfigValue } from '@testwise/shared';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { APPLE_APP_ATTEST_ROOT_PEM } from './apple-root';
import { decodeCbor } from './cbor';

type Policy = ConfigValue<'proctoring.policy'>;

export interface AttestationResult {
  /** Verified and acceptable under the policy. */
  ok: boolean;
  /** The check could not run (provider not configured/unreachable). Handled by `attestationFailOpen`. */
  unavailable: boolean;
  platform: 'android' | 'ios';
  level: 'STRONG' | 'DEVICE' | 'BASIC' | 'NONE';
  /** Machine-readable reasons, e.g. NOT_PLAY_RECOGNIZED, RISKY_APP:KNOWN_CAPTURING. */
  reasons: string[];
  /** Capturing / controlling / overlay app classes Play Integrity says are active. */
  riskyApps: string[];
  /** Stable hashed identifier of the attested install/key, for device bans. Never the raw id. */
  deviceHash: string | null;
}

const CHALLENGE_TTL = 300;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64url = (b: Buffer) => b.toString('base64url');

/** App Attest `aaguid` values: production is "appattest" + 7 zero bytes, development is "appattestdevelop". */
const AAGUID_PROD = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
const AAGUID_DEV = Buffer.from('appattestdevelop');
const NONCE_OID = Buffer.from('06092a864886f763640802', 'hex'); // 1.2.840.113635.100.8.2

@Injectable()
export class AttestationService {
  private readonly logger = new Logger('Attestation');
  private googleToken: { value: string; exp: number } | null = null;
  private readonly appleRoot = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------- Challenge

  /** One-time server nonce, bound to the user. Android sends it as the Play Integrity requestHash; iOS signs it. */
  async challenge(userId: string) {
    const id = randomBytes(12).toString('hex');
    const nonce = b64url(randomBytes(32));
    await this.redis.setJson(`attest:chal:${id}`, { userId, nonce }, CHALLENGE_TTL);
    return { challengeId: id, challenge: nonce, expiresInSeconds: CHALLENGE_TTL };
  }

  private async consume(challengeId: string, userId: string) {
    const key = `attest:chal:${challengeId}`;
    const c = await this.redis.getJson<{ userId: string; nonce: string }>(key);
    // Delete first: a challenge works once, even if verification then fails.
    await this.redis.del(key);
    if (!c || c.userId !== userId) throw new BadRequestException('Integrity challenge expired. Try again.');
    return c.nonce;
  }

  // ---------------------------------------------------------------- Entry point

  async verify(userId: string, challengeId: string | null | undefined, evidence: AttestationEvidence | null | undefined, policy: Policy): Promise<AttestationResult> {
    const platform = evidence?.platform ?? 'android';
    const fail = (reasons: string[], extra: Partial<AttestationResult> = {}): AttestationResult => ({ ok: false, unavailable: false, platform, level: 'NONE', reasons, riskyApps: [], deviceHash: null, ...extra });
    if (!evidence || !challengeId) return fail(['NO_EVIDENCE']);
    const nonce = await this.consume(challengeId, userId);
    try {
      return evidence.platform === 'android' ? await this.verifyPlayIntegrity(evidence.token, nonce, policy) : await this.verifyAppAttest(userId, evidence, nonce, policy);
    } catch (e) {
      if (e instanceof AttestationUnavailable) {
        this.logger.warn(`attestation unavailable: ${e.message}`);
        return fail([e.message], { unavailable: true });
      }
      this.logger.warn(`attestation rejected: ${(e as Error).message}`);
      return fail(['INVALID_EVIDENCE']);
    }
  }

  /** Salted hash so bans survive reinstalls of the same key/ID without storing a raw identifier. */
  static deviceHash(kind: 'install' | 'key', value: string) {
    return createHash('sha256').update(`${process.env.DEVICE_HASH_SALT ?? 'testwise'}:${kind}:${value}`).digest('hex');
  }

  // ---------------------------------------------------------------- Android: Play Integrity

  private serviceAccount(): { client_email: string; private_key: string } | null {
    const raw = process.env.PLAY_INTEGRITY_SA_JSON ?? (process.env.PLAY_INTEGRITY_SA_FILE ? readFileSync(process.env.PLAY_INTEGRITY_SA_FILE, 'utf8') : null);
    if (!raw) return null;
    const j = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return j.client_email && j.private_key ? j : null;
  }

  private async accessToken(sa: { client_email: string; private_key: string }) {
    if (this.googleToken && this.googleToken.exp > Date.now() + 60_000) return this.googleToken.value;
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new AttestationUnavailable('GOOGLE_AUTH_FAILED');
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.googleToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async verifyPlayIntegrity(token: string, nonce: string, policy: Policy): Promise<AttestationResult> {
    const sa = this.serviceAccount();
    const pkg = policy.attestationAndroidPackage;
    if (!sa || !pkg) throw new AttestationUnavailable('PLAY_INTEGRITY_NOT_CONFIGURED');
    const res = await fetch(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(pkg)}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken(sa)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ integrity_token: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 500 || res.status === 429) throw new AttestationUnavailable('PLAY_INTEGRITY_UNREACHABLE');
    if (!res.ok) throw new Error(`decode failed ${res.status}`); // malformed/forged token
    const body = (await res.json()) as { tokenPayloadExternal?: PlayPayload };
    return this.evaluatePlayPayload(body.tokenPayloadExternal, nonce, policy);
  }

  /** Pure policy evaluation of a decoded Play Integrity verdict (unit-tested). */
  evaluatePlayPayload(p: PlayPayload | undefined, nonce: string, policy: Policy, now = Date.now()): AttestationResult {
    const reasons: string[] = [];
    if (!p) return { ok: false, unavailable: false, platform: 'android', level: 'NONE', reasons: ['EMPTY_VERDICT'], riskyApps: [], deviceHash: null };
    const req = p.requestDetails ?? {};
    const requestHash = req.requestHash ?? req.nonce;
    if (requestHash !== nonce) reasons.push('CHALLENGE_MISMATCH');
    if (req.requestPackageName !== policy.attestationAndroidPackage) reasons.push('PACKAGE_MISMATCH');
    const ts = Number(req.timestampMillis ?? 0);
    if (!ts || Math.abs(now - ts) > 2 * 60_000) reasons.push('STALE_TOKEN');

    const app = p.appIntegrity ?? {};
    if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push('NOT_PLAY_RECOGNIZED');
    if (policy.attestationCertDigests.length && !(app.certificateSha256Digest ?? []).some((d) => policy.attestationCertDigests.includes(d))) reasons.push('SIGNING_CERT_MISMATCH');

    const labels = new Set(p.deviceIntegrity?.deviceRecognitionVerdict ?? []);
    const level = labels.has('MEETS_STRONG_INTEGRITY') ? 'STRONG' : labels.has('MEETS_DEVICE_INTEGRITY') ? 'DEVICE' : labels.has('MEETS_BASIC_INTEGRITY') ? 'BASIC' : 'NONE';
    if (level === 'NONE' || level === 'BASIC') reasons.push('DEVICE_NOT_CERTIFIED'); // rooted, unlocked bootloader with custom ROM, emulators, etc.
    if (policy.requireStrongIntegrity && level !== 'STRONG') reasons.push('NOT_STRONG_INTEGRITY');
    if (labels.has('MEETS_VIRTUAL_INTEGRITY') && !labels.has('MEETS_DEVICE_INTEGRITY') && policy.blockEmulator) reasons.push('EMULATOR');

    const env = p.environmentDetails ?? {};
    const detected = env.appAccessRiskVerdict?.appsDetected ?? [];
    const riskyApps = detected.filter((d) => /CAPTURING|CONTROLLING|OVERLAYS/.test(d));
    if (policy.blockRiskyApps) for (const r of riskyApps) reasons.push(`RISKY_APP:${r}`);
    if (env.playProtectVerdict && ['HIGH_RISK', 'MEDIUM_RISK'].includes(env.playProtectVerdict)) reasons.push(`PLAY_PROTECT:${env.playProtectVerdict}`);
    return { ok: reasons.length === 0, unavailable: false, platform: 'android', level, reasons, riskyApps, deviceHash: null };
  }

  // ---------------------------------------------------------------- iOS: App Attest

  private appIdHash(policy: Policy) {
    if (!policy.attestationIosAppId) throw new AttestationUnavailable('APP_ATTEST_NOT_CONFIGURED');
    return sha256(policy.attestationIosAppId);
  }

  private async verifyAppAttest(userId: string, ev: Extract<AttestationEvidence, { platform: 'ios' }>, nonce: string, policy: Policy): Promise<AttestationResult> {
    const rpHash = this.appIdHash(policy);
    const deviceHash = AttestationService.deviceHash('key', ev.keyId);
    const base = { unavailable: false, platform: 'ios' as const, riskyApps: [], deviceHash };
    const clientDataHash = sha256(nonce);

    if (ev.attestation) {
      const reasons = await this.verifyAttestationObject(userId, ev.keyId, ev.attestation, clientDataHash, rpHash);
      // Registration alone proves a genuine key; an assertion binds it to this exam, so also require it when supplied.
      return { ...base, ok: reasons.length === 0, level: reasons.length ? 'NONE' : 'DEVICE', reasons };
    }
    if (!ev.assertion) return { ...base, ok: false, level: 'NONE', reasons: ['NO_EVIDENCE'] };
    const reasons = await this.verifyAssertion(userId, ev.keyId, ev.assertion, clientDataHash, rpHash);
    return { ...base, ok: reasons.length === 0, level: reasons.length ? 'NONE' : 'DEVICE', reasons };
  }

  private async verifyAttestationObject(userId: string, keyId: string, attestation: string, clientDataHash: Buffer, rpHash: Buffer): Promise<string[]> {
    const obj = decodeCbor(b64(attestation)) as { fmt?: string; attStmt?: { x5c?: Buffer[] }; authData?: Buffer };
    if (obj.fmt !== 'apple-appattest' || !obj.attStmt?.x5c || obj.attStmt.x5c.length < 2 || !obj.authData) return ['BAD_ATTESTATION_FORMAT'];
    const [leaf, inter] = obj.attStmt.x5c.map((c) => new X509Certificate(c));
    const now = Date.now();
    const valid = (c: X509Certificate) => new Date(c.validFrom).getTime() <= now && now <= new Date(c.validTo).getTime();
    // 1. Chain: leaf <- intermediate <- pinned Apple root.
    if (!leaf.verify(inter.publicKey) || !inter.verify(this.appleRoot.publicKey) || !valid(leaf) || !valid(inter)) return ['BAD_CERT_CHAIN'];
    // 2. Nonce in the leaf extension == SHA256(authData || clientDataHash): binds the attestation to our challenge.
    const expected = sha256(Buffer.concat([obj.authData, clientDataHash]));
    const certNonce = extractNonce(leaf.raw);
    if (!certNonce || !certNonce.equals(expected)) return ['NONCE_MISMATCH'];
    // 3. keyId == SHA256 of the leaf's uncompressed public point.
    const jwk = leaf.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    const keyHash = sha256(point);
    if (!keyHash.equals(b64(keyId))) return ['KEY_ID_MISMATCH'];
    // 4. authData: rpIdHash, counter 0, environment, credentialId.
    const a = obj.authData;
    if (a.length < 55) return ['BAD_AUTH_DATA'];
    if (!a.subarray(0, 32).equals(rpHash)) return ['APP_ID_MISMATCH'];
    if (a.readUInt32BE(33) !== 0) return ['COUNTER_NOT_ZERO'];
    const aaguid = a.subarray(37, 53);
    const prod = process.env.NODE_ENV === 'production';
    if (!aaguid.equals(AAGUID_PROD) && !(aaguid.equals(AAGUID_DEV) && !prod)) return ['BAD_ENVIRONMENT'];
    const credLen = a.readUInt16BE(53);
    if (!a.subarray(55, 55 + credLen).equals(keyHash)) return ['CREDENTIAL_ID_MISMATCH'];
    // 5. Remember the key for later per-exam assertions. A key is bound to the first user that registers it.
    const existing = await this.prisma.attestedKey.findUnique({ where: { keyId } });
    if (existing && existing.userId !== userId) return ['KEY_OWNED_BY_OTHER_USER'];
    if (!existing) await this.prisma.attestedKey.create({ data: { keyId, userId, publicKey: leaf.publicKey.export({ type: 'spki', format: 'pem' }).toString() } });
    return [];
  }

  private async verifyAssertion(userId: string, keyId: string, assertion: string, clientDataHash: Buffer, rpHash: Buffer): Promise<string[]> {
    const key = await this.prisma.attestedKey.findUnique({ where: { keyId } });
    if (!key || key.userId !== userId) return ['UNKNOWN_KEY']; // app must register (attest) this key first
    const obj = decodeCbor(b64(assertion)) as { signature?: Buffer; authenticatorData?: Buffer };
    if (!obj.signature || !obj.authenticatorData || obj.authenticatorData.length < 37) return ['BAD_ASSERTION_FORMAT'];
    const nonce = sha256(Buffer.concat([obj.authenticatorData, clientDataHash]));
    const ok = createVerify('sha256').update(nonce).verify(createPublicKey(key.publicKey), obj.signature);
    if (!ok) return ['BAD_SIGNATURE'];
    if (!obj.authenticatorData.subarray(0, 32).equals(rpHash)) return ['APP_ID_MISMATCH'];
    const counter = obj.authenticatorData.readUInt32BE(33);
    // Atomic: counter must strictly increase, so a captured assertion cannot be replayed.
    const bumped = await this.prisma.attestedKey.updateMany({ where: { keyId, counter: { lt: counter } }, data: { counter, lastUsedAt: new Date() } });
    return bumped.count === 1 ? [] : ['COUNTER_REPLAY'];
  }
}

class AttestationUnavailable extends Error {}

/** Finds the App Attest nonce (OID 1.2.840.113635.100.8.2) in a DER certificate: ... OID OCTET STRING { SEQUENCE { [1] { OCTET STRING nonce } } }. */
export function extractNonce(der: Buffer): Buffer | null {
  const at = der.indexOf(NONCE_OID);
  if (at < 0) return null;
  let p = at + NONCE_OID.length;
  if (der[p] === 0x01) p += 3; // optional BOOLEAN critical
  if (der[p++] !== 0x04) return null;
  let len = der[p++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = der.readUIntBE(p, n);
    p += n;
  }
  const ext = der.subarray(p, p + len);
  const tail = ext.subarray(-34);
  return tail.length === 34 && tail[0] === 0x04 && tail[1] === 0x20 ? Buffer.from(tail.subarray(2)) : null;
}

export interface PlayPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; nonce?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[]; versionCode?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  environmentDetails?: { appAccessRiskVerdict?: { appsDetected?: string[] }; playProtectVerdict?: string };
}
