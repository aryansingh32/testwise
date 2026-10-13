import { createHash, generateKeyPairSync, createSign } from 'node:crypto';
import { CONFIG_REGISTRY } from '@testwise/shared';
import { AttestationService, extractNonce, type PlayPayload } from './attestation.service';
import { decodeCbor } from './cbor';

const policy = { ...CONFIG_REGISTRY['proctoring.policy'].default, attestationAndroidPackage: 'app.testwise.student', attestationCertDigests: ['CERTDIGEST'] } as never;
const svc = new AttestationService(null as never, null as never);
const NONCE = 'nonce-123';
const good = (over: Partial<PlayPayload> = {}): PlayPayload => ({
  requestDetails: { requestPackageName: 'app.testwise.student', requestHash: NONCE, timestampMillis: String(Date.now()) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', certificateSha256Digest: ['CERTDIGEST'] },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  environmentDetails: { appAccessRiskVerdict: { appsDetected: ['KNOWN_INSTALLED'] }, playProtectVerdict: 'NO_ISSUES' },
  ...over,
});

describe('Play Integrity verdict evaluation', () => {
  it('accepts a genuine app on a certified device', () => expect(svc.evaluatePlayPayload(good(), NONCE, policy).ok).toBe(true));
  it.each([
    ['rooted / uncertified device', good({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }), 'DEVICE_NOT_CERTIFIED'],
    ['empty device verdict', good({ deviceIntegrity: {} }), 'DEVICE_NOT_CERTIFIED'],
    ['repackaged/sideloaded app', good({ appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', certificateSha256Digest: ['CERTDIGEST'] } }), 'NOT_PLAY_RECOGNIZED'],
    ['wrong signing certificate', good({ appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', certificateSha256Digest: ['OTHER'] } }), 'SIGNING_CERT_MISMATCH'],
    ['wrong package', good({ requestDetails: { requestPackageName: 'evil.app', requestHash: NONCE, timestampMillis: String(Date.now()) } }), 'PACKAGE_MISMATCH'],
    ['replayed / other challenge', good({ requestDetails: { requestPackageName: 'app.testwise.student', requestHash: 'old', timestampMillis: String(Date.now()) } }), 'CHALLENGE_MISMATCH'],
    ['stale token', good({ requestDetails: { requestPackageName: 'app.testwise.student', requestHash: NONCE, timestampMillis: String(Date.now() - 10 * 60_000) } }), 'STALE_TOKEN'],
    ['screen capture app running', good({ environmentDetails: { appAccessRiskVerdict: { appsDetected: ['UNKNOWN_CAPTURING'] } } }), 'RISKY_APP:UNKNOWN_CAPTURING'],
    ['remote control app running', good({ environmentDetails: { appAccessRiskVerdict: { appsDetected: ['KNOWN_CONTROLLING'] } } }), 'RISKY_APP:KNOWN_CONTROLLING'],
    ['overlay app running', good({ environmentDetails: { appAccessRiskVerdict: { appsDetected: ['KNOWN_OVERLAYS'] } } }), 'RISKY_APP:KNOWN_OVERLAYS'],
    ['emulator', good({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_VIRTUAL_INTEGRITY'] } }), 'EMULATOR'],
  ])('rejects %s', (_n, payload, reason) => {
    const r = svc.evaluatePlayPayload(payload, NONCE, policy);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain(reason);
  });
  it('strong integrity can be required', () => {
    const strict = { ...(policy as object), requireStrongIntegrity: true } as never;
    expect(svc.evaluatePlayPayload(good(), NONCE, strict).reasons).toContain('NOT_STRONG_INTEGRITY');
    expect(svc.evaluatePlayPayload(good({ deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_STRONG_INTEGRITY', 'MEETS_DEVICE_INTEGRITY'] } }), NONCE, strict).ok).toBe(true);
  });
  it('rejects an empty verdict', () => expect(svc.evaluatePlayPayload(undefined, NONCE, policy).ok).toBe(false));
});

describe('CBOR + App Attest helpers', () => {
  it('decodes maps, arrays, bytes, text and ints', () => {
    // {"fmt":"apple-appattest","n":[1,-2],"b":h'0102'}
    const buf = Buffer.from('a363666d74' + Buffer.from('apple-appattest').toString('hex').padStart(0, '') , 'hex');
    expect(buf.length).toBeGreaterThan(0);
    const enc = Buffer.concat([
      Buffer.from([0xa3]),
      Buffer.from([0x63]), Buffer.from('fmt'), Buffer.from([0x6f]), Buffer.from('apple-appattest'),
      Buffer.from([0x61]), Buffer.from('n'), Buffer.from([0x82, 0x01, 0x21]),
      Buffer.from([0x61]), Buffer.from('b'), Buffer.from([0x42, 0x01, 0x02]),
    ]);
    const v = decodeCbor(enc) as { fmt: string; n: number[]; b: Buffer };
    expect(v.fmt).toBe('apple-appattest');
    expect(v.n).toEqual([1, -2]);
    expect([...v.b]).toEqual([1, 2]);
  });
  it('rejects truncated input', () => expect(() => decodeCbor(Buffer.from([0x58, 0x20, 0x01]))).toThrow());
  it('extracts the nonce extension from DER', () => {
    const nonce = Buffer.alloc(32, 7);
    const oid = Buffer.from('06092a864886f763640802', 'hex');
    const inner = Buffer.concat([Buffer.from([0x30, 0x24, 0xa1, 0x22, 0x04, 0x20]), nonce]);
    const der = Buffer.concat([Buffer.from([0x30, 0x82]), oid, Buffer.from([0x04, inner.length]), inner]);
    expect(extractNonce(der)?.equals(nonce)).toBe(true);
    expect(extractNonce(Buffer.from('nothing here'))).toBeNull();
  });
});

describe('App Attest assertions', () => {
  const sha = (b: Buffer | string): Buffer => createHash('sha256').update(b).digest();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const appId = 'TEAM123.app.testwise.student';
  const pol = { ...(policy as object), attestationIosAppId: appId } as never;
  const store = { counter: 0 };
  const prisma = {
    attestedKey: {
      findUnique: async () => ({ keyId: 'K', userId: 'u1', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), counter: store.counter }),
      updateMany: async ({ data }: { data: { counter: number } }) => {
        if (data.counter > store.counter) { store.counter = data.counter; return { count: 1 }; }
        return { count: 0 };
      },
    },
  };
  const redisStore = new Map<string, unknown>();
  const redis = { setJson: async (k: string, v: unknown) => void redisStore.set(k, v), getJson: async (k: string) => redisStore.get(k) ?? null, del: async (k: string) => void redisStore.delete(k) };
  const s = new AttestationService(prisma as never, redis as never);

  const cborAssertion = (sig: Buffer, authData: Buffer) => {
    const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
    const text = (t: string) => Buffer.concat([head(3, t.length), Buffer.from(t)]);
    const bytes = (b: Buffer) => Buffer.concat([head(2, b.length), b]);
    return Buffer.concat([head(5, 2), text('signature'), bytes(sig), text('authenticatorData'), bytes(authData)]).toString('base64');
  };
  const authData = (counter: number, rp: Buffer = sha(appId)) => Buffer.concat([rp, Buffer.from([0x01]), Buffer.from([counter >>> 24, counter >>> 16, counter >>> 8, counter].map((x) => x & 255))]);
  const make = async (counter: number, rp?: Buffer) => {
    const ch = await s.challenge('u1');
    const ad = authData(counter, rp ?? sha(appId));
    const nonce = sha(Buffer.concat([ad, sha(ch.challenge)]));
    const sig = createSign('sha256').update(nonce).sign(privateKey);
    return { ch, assertion: cborAssertion(sig, ad) };
  };

  it('accepts a valid assertion and rejects its replay', async () => {
    const { ch, assertion } = await make(1);
    const ev = { platform: 'ios' as const, keyId: 'K', assertion };
    // challenge is single-use, so replay needs a fresh challenge but the same (old) counter
    expect((await s.verify('u1', ch.challengeId, ev, pol)).ok).toBe(true);
    const again = await make(1);
    const r = await s.verify('u1', again.ch.challengeId, { platform: 'ios', keyId: 'K', assertion: again.assertion }, pol);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('COUNTER_REPLAY');
  });
  it('rejects a challenge that was already used', async () => {
    const { ch, assertion } = await make(5);
    await s.verify('u1', ch.challengeId, { platform: 'ios', keyId: 'K', assertion }, pol);
    await expect(s.verify('u1', ch.challengeId, { platform: 'ios', keyId: 'K', assertion }, pol)).rejects.toThrow();
  });
  it("rejects another user's challenge", async () => {
    const { ch, assertion } = await make(9);
    await expect(s.verify('someone-else', ch.challengeId, { platform: 'ios', keyId: 'K', assertion }, pol)).rejects.toThrow();
  });
  it('rejects a wrong app id', async () => {
    const { ch, assertion } = await make(20, sha('OTHER.app'));
    const r = await s.verify('u1', ch.challengeId, { platform: 'ios', keyId: 'K', assertion }, pol);
    expect(r.reasons).toContain('APP_ID_MISMATCH');
  });
  it('rejects a forged signature', async () => {
    const { ch } = await make(30);
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    const ad = authData(30);
    const bad = cborAssertion(createSign('sha256').update(sha(Buffer.concat([ad, sha(ch.challenge)]))).sign(other), ad);
    const r = await s.verify('u1', ch.challengeId, { platform: 'ios', keyId: 'K', assertion: bad }, pol);
    expect(r.reasons).toContain('BAD_SIGNATURE');
  });
  it('reports unavailable (not failed) when iOS is not configured', async () => {
    const ch = await s.challenge('u1');
    const r = await s.verify('u1', ch.challengeId, { platform: 'ios', keyId: 'K', assertion: 'x' }, policy);
    expect(r.unavailable).toBe(true);
  });
  it('deviceHash is stable and does not contain the raw id', () => {
    const h = AttestationService.deviceHash('install', 'abc');
    expect(h).toBe(AttestationService.deviceHash('install', 'abc'));
    expect(h).not.toContain('abc');
    expect(h).not.toBe(AttestationService.deviceHash('key', 'abc'));
  });
});
