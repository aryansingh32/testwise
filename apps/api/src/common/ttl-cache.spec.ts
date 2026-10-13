import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shares one in-flight load between concurrent callers (no stampede)', async () => {
    const cache = new TtlCache(1000);
    const load = jest.fn(async () => 'v');
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get('k', load)));
    expect(results.every((r) => r === 'v')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL expires', async () => {
    const cache = new TtlCache(1000);
    const load = jest.fn(async () => 'v');
    await cache.get('k', load);
    jest.advanceTimersByTime(999);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never caches a failed load', async () => {
    const cache = new TtlCache(1000);
    const load = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('ok');
    await expect(cache.get('k', load)).rejects.toThrow('db down');
    await expect(cache.get('k', load)).resolves.toBe('ok');
  });

  it('is bounded: clears when it reaches maxEntries', async () => {
    const cache = new TtlCache(1000, 2);
    const load = jest.fn(async () => 'v');
    await cache.get('a', load); await cache.get('b', load); await cache.get('c', load);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
