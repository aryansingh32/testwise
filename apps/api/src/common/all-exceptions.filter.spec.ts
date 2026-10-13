import { ArgumentsHost, BadRequestException, ConflictException, ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown, { type = 'http', headersSent = false } = {}) {
  const out: { status?: number; body?: Record<string, unknown>; headers: Record<string, string> } = { headers: {} };
  const res = {
    headersSent,
    getHeader: (k: string) => out.headers[k],
    setHeader: (k: string, v: string) => (out.headers[k] = v),
    status(n: number) { out.status = n; return this; },
    json(b: Record<string, unknown>) { out.body = b; },
  };
  const req = { id: 'req-12345678', method: 'GET', originalUrl: '/v1/x?secret=1', url: '/v1/x' };
  const host = { getType: () => type, switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}
const known = (code: string) => new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'x' });

describe('AllExceptionsFilter', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('always returns one shape with statusCode, error, message and requestId', () => {
    const r = run(new NotFoundException('Order not found'));
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ message: 'Order not found', statusCode: 404, error: 'Not Found', requestId: 'req-12345678' });
  });

  it('keeps extra fields clients rely on (zod issues) and string-only HttpException bodies', () => {
    const v = run(new BadRequestException({ message: 'Validation failed', issues: [{ path: 'email', message: 'Invalid' }] }));
    expect(v.body).toMatchObject({ message: 'Validation failed', issues: [{ path: 'email', message: 'Invalid' }], statusCode: 400 });
    expect(run(new HttpException('Too many failed sign-in attempts.', 429)).body).toMatchObject({ message: 'Too many failed sign-in attempts.', statusCode: 429 });
    expect(run(new ForbiddenException()).status).toBe(403);
    expect(run(new ConflictException('x')).status).toBe(409);
  });

  it('maps a missing record to 404, duplicates to 409, foreign-key conflicts to 409', () => {
    expect(run(known('P2025')).status).toBe(404);
    expect(run(known('P2002')).status).toBe(409);
    expect(run(known('P2003')).status).toBe(409);
  });

  it('maps pool exhaustion / unreachable DB to 503 with Retry-After, and write conflicts to retryable 409', () => {
    for (const code of ['P2024', 'P1001', 'P1008', 'P2037']) {
      const r = run(known(code));
      expect(r.status).toBe(503);
      expect(r.headers['Retry-After']).toBeDefined();
    }
    const c = run(known('P2034'));
    expect(c.status).toBe(409);
    expect(c.headers['Retry-After']).toBe('1');
    expect(run(new Prisma.PrismaClientInitializationError('cannot reach', 'x')).status).toBe(503);
  });

  it('maps un-storable values and bad query shapes to 400 without echoing Prisma internals', () => {
    expect(run(known('P2000')).status).toBe(400);
    const v = run(new Prisma.PrismaClientValidationError('Argument `take` is invalid ... secret internals', { clientVersion: 'x' }));
    expect(v.status).toBe(400);
    expect(JSON.stringify(v.body)).not.toMatch(/Argument|take|internals|Prisma/);
    const nul = run(new Prisma.PrismaClientUnknownRequestError('invalid byte sequence for encoding "UTF8": 0x00', { clientVersion: 'x' }));
    expect(nul.status).toBe(400);
  });

  it('maps HTTP-layer parser errors (too large, malformed JSON) instead of reporting 500', () => {
    expect(run(Object.assign(new Error('too big'), { status: 413, type: 'entity.too.large' })).status).toBe(413);
    const bad = run(Object.assign(new SyntaxError('Unexpected token'), { status: 400, type: 'entity.parse.failed' }));
    expect(bad.status).toBe(400);
    expect(bad.body?.message).toBe('Malformed JSON body');
  });

  it('turns unknown errors into a generic 500 that leaks nothing, and logs them with the request id', () => {
    const err = jest.spyOn(Logger.prototype, 'error');
    const r = run(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
    expect(r.body?.requestId).toBe('req-12345678');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('req-12345678');
    expect(String(err.mock.calls[0][0])).not.toContain('secret=1'); // query string is never logged
  });

  it('does nothing if the response already started, and defers non-HTTP contexts', () => {
    expect(run(new Error('x'), { headersSent: true }).status).toBeUndefined();
    expect(() => run(new Error('x'), { type: 'ws' })).toThrow('x');
  });
});
