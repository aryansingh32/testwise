import { PaymentsService } from './payments.service';

function svc() {
  return new PaymentsService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe('PaymentsService.singleFlight', () => {
  it('runs once for N concurrent callers with the same key and shares the result', async () => {
    const s = svc();
    const run = jest.fn(() => new Promise<string>((r) => setTimeout(() => r('order-1'), 20)));
    const results = await Promise.all(Array.from({ length: 25 }, () => s.singleFlight('k', run)));
    expect(run).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set(['order-1']));
  });
  it('does not merge different keys, and lets a later call run again once the first finished', async () => {
    const s = svc();
    const run = jest.fn(async () => 'x');
    await Promise.all([s.singleFlight('a', run), s.singleFlight('b', run)]);
    expect(run).toHaveBeenCalledTimes(2);
    await s.singleFlight('a', run);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('shares a failure with concurrent callers but does not cache it', async () => {
    const s = svc();
    const run = jest.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce('ok');
    await expect(Promise.all([s.singleFlight('k', run), s.singleFlight('k', run)])).rejects.toThrow('db');
    await expect(s.singleFlight('k', run)).resolves.toBe('ok');
  });
});
