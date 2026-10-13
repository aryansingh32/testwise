/**
 * Tiny in-process TTL cache with single-flight: concurrent callers of one key share one in-flight load, so a cold or
 * expired entry under load costs one query, not one per request. Only for data every user sees the same way and that
 * may be a few seconds stale (public content, leaderboards).
 */
export class TtlCache {
  private readonly entries = new Map<string, { exp: number; value: Promise<unknown> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000,
  ) {}

  get<V>(key: string, load: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.exp > now) return hit.value as Promise<V>;
    if (this.entries.size >= this.maxEntries) this.entries.clear();
    const value = load().catch((e) => {
      this.entries.delete(key); // never cache a failure
      throw e;
    });
    this.entries.set(key, { exp: now + this.ttlMs, value });
    return value;
  }

  /** Store an already-known value (e.g. right after creating it) so the first reader does not hit the database. */
  set<V>(key: string, value: V) {
    if (this.entries.size >= this.maxEntries) this.entries.clear();
    this.entries.set(key, { exp: Date.now() + this.ttlMs, value: Promise.resolve(value) });
  }

  clear() {
    this.entries.clear();
  }
}
