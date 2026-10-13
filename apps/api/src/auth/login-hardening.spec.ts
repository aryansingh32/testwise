import { HttpException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../common/redis.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => {
  const real = jest.requireActual('bcrypt');
  return { ...real, compare: jest.fn(real.compare) };
});

function make(passwordHash: string | null) {
  const prisma = { user: { findUnique: async () => (passwordHash ? { id: 'u1', email: 'a@x.com', passwordHash, status: 'ACTIVE', deletedAt: null } : null) } };
  const redis = new RedisService(); // no REDIS_URL in tests: in-memory counters
  const svc = new AuthService(prisma as never, null as never, { get: async () => ({ emailPassword: true }) } as never, null as never, null as never, null as never, redis);
  jest.spyOn(svc as never, 'session' as never).mockImplementation((async () => ({ ok: true })) as never);
  return { svc, redis };
}

describe('student login hardening', () => {
  const hash = bcrypt.hashSync('Correct-Horse-1', 4);
  beforeAll(() => { delete process.env.REDIS_URL; });

  it('locks an account after 10 failures, even for the right password, and a success resets the counter', async () => {
    const { svc, redis } = make(hash);
    for (let i = 0; i < 9; i++) await expect(svc.login({ email: 'a@x.com', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.login({ email: 'a@x.com', password: 'Correct-Horse-1' })).resolves.toEqual({ ok: true });
    expect(await redis.counter('login-fail:a@x.com')).toBe(0);
    for (let i = 0; i < 10; i++) await expect(svc.login({ email: 'a@x.com', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
    const locked = await svc.login({ email: 'a@x.com', password: 'Correct-Horse-1' }).catch((e) => e);
    expect(locked).toBeInstanceOf(HttpException);
    expect((locked as HttpException).getStatus()).toBe(429);
  });

  it('runs a bcrypt compare for unknown emails too (no timing difference to enumerate accounts)', async () => {
    const { svc } = make(null);
    const spy = bcrypt.compare as unknown as jest.Mock;
    spy.mockClear();
    await expect(svc.login({ email: 'nobody@x.com', password: 'whatever' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
