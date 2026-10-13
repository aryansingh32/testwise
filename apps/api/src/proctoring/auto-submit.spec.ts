import { CONFIG_REGISTRY, trustBand, trustScore } from '@testwise/shared';
import { ProctoringService } from './proctoring.service';

const policy = { ...CONFIG_REGISTRY['proctoring.policy'].default, autoTerminateOnCritical: false, autoTerminateAtPoints: 0 };
const session = (over: Record<string, unknown> = {}) => ({ id: 's1', attemptId: 'a1', userId: 'u1', tournamentId: 't1', status: 'ACTIVE', riskScore: 0, flagCount: 0, features: { autoSubmit: true }, ...over });

function setup(opts: { flagCount?: number; riskScore?: number; features?: Record<string, boolean> | null } = {}) {
  const created = { id: 'f1', sessionId: 's1', attemptId: 'a1', userId: 'u1', tournamentId: 't1', type: '', severity: 'HIGH', source: 'DEVICE', confidence: 1, message: '', details: {}, evidence: [], status: 'OPEN', reviewNote: null, reviewedAt: null, occurredAt: new Date(), points: 0 };
  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      proctorFlag: { create: async ({ data }: { data: object }) => ({ ...created, ...data }) },
      proctorSession: { update: async () => ({}) },
      attemptEvent: { create: async () => ({}) },
    }),
    proctorSession: { findUniqueOrThrow: async () => session({ riskScore: opts.riskScore ?? 0, features: opts.features === undefined ? { autoSubmit: true } : opts.features }) },
    proctorFlag: { count: async () => opts.flagCount ?? 1 },
    proctorAction: { findFirst: async () => null },
    user: { findUnique: async () => null }, tournament: { findUnique: async () => null }, attempt: { findUnique: async () => null },
  };
  const bus = { toAdmins: jest.fn(), toStudent: jest.fn() };
  const redisCounts = new Map<string, number>();
  const redis = { incr: async (k: string) => { redisCounts.set(k, (redisCounts.get(k) ?? 0) + 1); return redisCounts.get(k)!; } };
  const config = { get: async () => policy };
  const svc = new ProctoringService(prisma as never, config as never, null as never, null as never, null as never, null as never, redis as never, null as never, null as never, bus as never, null as never, null as never);
  const warn = jest.spyOn(svc, 'warn').mockResolvedValue({ ok: true });
  const terminate = jest.spyOn(svc, 'terminate').mockResolvedValue({ ok: true });
  return { svc, warn, terminate, bus };
}
const raise = (svc: ProctoringService, type: string, confidence = 1) => svc.raise(session() as never, { type: type as never, source: 'DEVICE', confidence, message: null, details: {}, evidence: [] });

describe('automatic submission', () => {
  it('warns with the number of chances left on the first app switch', async () => {
    const { svc, warn, terminate } = setup({ flagCount: 1 });
    await raise(svc, 'APP_SWITCH');
    expect(terminate).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][1]).toMatchObject({ en: expect.stringContaining('2 more times') });
  });
  it('submits on the third app switch', async () => {
    const { svc, terminate } = setup({ flagCount: 3 });
    await raise(svc, 'APP_SWITCH');
    expect(terminate).toHaveBeenCalledWith('s1', expect.stringContaining('Submitted automatically'), { type: 'SYSTEM' });
  });
  it('submits on repeated multiple faces', async () => {
    const { svc, terminate } = setup({ flagCount: 3 });
    await raise(svc, 'MULTIPLE_FACES', 0.9);
    expect(terminate).toHaveBeenCalled();
  });
  it('ignores a low-confidence multiple-faces detection for auto-submit', async () => {
    const { svc, terminate } = setup({ flagCount: 9 });
    await raise(svc, 'MULTIPLE_FACES', 0.5);
    expect(terminate).not.toHaveBeenCalled();
  });
  it.each(['SCREEN_RECORDING', 'PHONE_DETECTED', 'VOICE_DETECTED', 'ROOTED_DEVICE', 'SCREEN_SHARE_STOPPED', 'CAMERA_BLOCKED'])('never auto-submits for %s (admin decides)', async (type) => {
    const { svc, terminate } = setup({ flagCount: 50 });
    await raise(svc, type);
    expect(terminate).not.toHaveBeenCalled();
  });
  it('does nothing automatic when the exam has auto-submit switched off', async () => {
    const { svc, terminate, warn } = setup({ flagCount: 50, features: { autoSubmit: false } });
    await raise(svc, 'APP_SWITCH');
    expect(terminate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1); // ordinary cooldown warning only
  });
});

describe('trust score', () => {
  it('starts at 100, loses flag points, and is clamped', () => {
    expect(trustScore(0)).toBe(100);
    expect(trustScore(35)).toBe(65);
    expect(trustScore(400)).toBe(0);
  });
  it('bands against the review line', () => {
    expect(trustBand(80, 60)).toBe('OK');
    expect(trustBand(59, 60)).toBe('REVIEW');
    expect(trustBand(29, 60)).toBe('LOW');
  });
  it('raises one LOW_TRUST flag for admins when the score crosses the line, and never auto-submits for it', async () => {
    const { svc, terminate, bus } = setup({ riskScore: 55, flagCount: 1 });
    await raise(svc, 'VOICE_DETECTED');
    await raise(svc, 'VOICE_DETECTED');
    const lowTrust = bus.toAdmins.mock.calls.filter((c) => c[1] === 'flag:new' && c[2].type === 'LOW_TRUST');
    expect(lowTrust).toHaveLength(1);
    expect(terminate).not.toHaveBeenCalled();
  });
});
