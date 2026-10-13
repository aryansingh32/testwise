import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ProctoringService } from './proctoring.service';

const admin = { type: 'ADMIN' as const, id: 'adm1' };
function make(attempt: Record<string, unknown> | null) {
  const calls: Record<string, unknown[]> = { attempt: [], answers: [], session: [], action: [], event: [] };
  const tx = {
    attempt: { update: async (a: unknown) => void calls.attempt.push(a) },
    attemptAnswer: { updateMany: async (a: unknown) => void calls.answers.push(a) },
    proctorSession: { update: async (a: unknown) => void calls.session.push(a) },
    proctorAction: { create: async (a: unknown) => void calls.action.push(a) },
    attemptEvent: { create: async (a: unknown) => void calls.event.push(a) },
  };
  const prisma = { attempt: { findUnique: async () => attempt }, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
  const audit = { log: jest.fn() };
  const bus = { toAdmins: jest.fn() };
  const svc = new ProctoringService(prisma as never, null as never, audit as never, null as never, null as never, null as never, null as never, null as never, null as never, bus as never, null as never, null as never);
  return { svc, calls, audit };
}
const minutes = (n: number) => n * 60_000;
const base = (over: Record<string, unknown> = {}) => ({
  id: 'a1', userId: 'u1', tournamentId: null, tournament: null, status: 'AUTO_SUBMITTED',
  submittedAt: new Date(Date.now() - minutes(2)), deadlineAt: new Date(Date.now() + minutes(18)), proctor: { id: 's1' }, ...over,
});

describe('reinstateAttempt (admin only)', () => {
  it('reopens a practice attempt with the time that was left, clears the score and logs it', async () => {
    const { svc, calls, audit } = make(base());
    const r = await svc.reinstateAttempt('a1', { reason: 'false alarm' }, admin);
    expect(r.minutes).toBe(20);
    expect(calls.attempt[0]).toMatchObject({ data: { status: 'IN_PROGRESS', submittedAt: null, score: null } });
    expect(calls.answers[0]).toMatchObject({ data: { isCorrect: null, marksAwarded: null } });
    expect(calls.session[0]).toMatchObject({ data: { status: 'ACTIVE' } });
    expect(calls.action[0]).toMatchObject({ data: { type: 'REINSTATE', message: 'false alarm' } });
    expect(audit.log).toHaveBeenCalled();
  });
  it('lets the admin choose the minutes', async () => {
    const { svc } = make(base());
    expect((await svc.reinstateAttempt('a1', { reason: 'x y z', minutes: 7 }, admin)).minutes).toBe(7);
  });
  it('never reopens past the tournament window', async () => {
    const { svc } = make(base({ tournamentId: 't1', tournament: { status: 'LIVE', endsAt: new Date(Date.now() + minutes(5)) } }));
    expect((await svc.reinstateAttempt('a1', { reason: 'x y z', minutes: 30 }, admin)).minutes).toBe(5);
  });
  it('refuses once the tournament window has closed', async () => {
    const { svc } = make(base({ tournamentId: 't1', tournament: { status: 'IN_REVIEW', endsAt: new Date(Date.now() - minutes(1)) } }));
    await expect(svc.reinstateAttempt('a1', { reason: 'x y z' }, admin)).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses an attempt that is already running', async () => {
    const { svc } = make(base({ status: 'IN_PROGRESS' }));
    await expect(svc.reinstateAttempt('a1', { reason: 'x y z' }, admin)).rejects.toBeInstanceOf(ConflictException);
  });
  it('is not available to the system or students', async () => {
    const { svc } = make(base());
    await expect(svc.reinstateAttempt('a1', { reason: 'x y z' }, { type: 'SYSTEM' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
