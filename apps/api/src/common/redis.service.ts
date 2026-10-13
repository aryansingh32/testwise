import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Redis access for the whole API: distributed job locks (so background jobs run on one
 * instance at a time), short-lived caches, pub/sub between instances and counters.
 *
 * REDIS_URL is required in production. Without it (local dev, unit tests) the service
 * falls back to in-process equivalents, which is correct for a single instance only.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  readonly instanceId = randomUUID();
  readonly client: Redis | null;
  private readonly sub: Redis | null;
  private readonly local = new EventEmitter();
  private readonly localLocks = new Map<string, number>();
  private readonly localCache = new Map<string, { value: string; until: number }>();
  /** Circuit breaker: while Date.now() < openUntil, Redis is considered down and callers use their in-process fallback. */
  private openUntil = 0;
  private lastDownLog = 0;

  /** Run a Redis operation; on timeout/failure open the breaker and return the fallback. */
  private async safe<T>(op: (c: Redis) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    if (!this.client || Date.now() < this.openUntil) return fallback();
    try {
      return await op(this.client);
    } catch (e) {
      this.openUntil = Date.now() + 5_000;
      if (Date.now() - this.lastDownLog > 30_000) {
        this.lastDownLog = Date.now();
        this.logger.error(`Redis unavailable, degrading to in-process fallbacks for 5s: ${(e as Error).message}`);
      }
      return fallback();
    }
  }

  get degraded() {
    return Date.now() < this.openUntil;
  }

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      if (process.env.NODE_ENV === 'production') throw new Error('REDIS_URL is required in production');
      this.logger.warn('REDIS_URL not set: using in-process fallback (single instance only)');
      this.client = null;
      this.sub = null;
      return;
    }
    // Fail fast when Redis is slow or gone: a command rejects after 1s instead of queueing for many seconds, and the
    // circuit breaker below then skips Redis entirely for a few seconds so requests are not each made to wait.
    const opts = { maxRetriesPerRequest: 1, commandTimeout: 1000, connectTimeout: 2000, enableReadyCheck: true, lazyConnect: false, retryStrategy: (times: number) => Math.min(times * 200, 2000) };
    this.client = new Redis(url, opts);
    this.sub = new Redis(url, opts);
    this.client.on('error', (e) => this.logger.error(`client: ${e.message}`));
    this.sub.on('error', (e) => this.logger.error(`subscriber: ${e.message}`));
    this.sub.on('message', (channel: string, message: string) => {
      try {
        this.local.emit(channel, JSON.parse(message));
      } catch {
        // Ignore malformed messages from other publishers.
      }
    });
  }

  get enabled() {
    return this.client !== null;
  }

  async ping() {
    if (!this.client) return 'disabled';
    return this.safe((c) => c.ping(), () => 'DOWN');
  }

  /** Separate connections for adapters that need their own pub/sub pair (Socket.IO). */
  duplicatePair(): [Redis, Redis] | null {
    if (!this.client) return null;
    return [this.client.duplicate(), this.client.duplicate()];
  }

  // ------------------------------------------------------------- Locks

  /**
   * Run `fn` only if this instance wins the lock. Returns undefined when another
   * instance holds it. The lock expires after `ttlMs` even if the process dies.
   */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const key = `lock:${name}`;
    const token = randomUUID();
    if (this.client) {
      // Without Redis nobody can prove they hold the lock: skip the job (it runs on the next tick) rather than risk two instances running it.
      const ok = await this.safe((c) => c.set(key, token, 'PX', ttlMs, 'NX'), () => null);
      if (ok !== 'OK') return undefined;
      try {
        return await fn();
      } finally {
        await this.client.eval(RELEASE_LOCK, 1, key, token).catch(() => undefined);
      }
    }
    const held = this.localLocks.get(key);
    if (held && held > Date.now()) return undefined;
    this.localLocks.set(key, Date.now() + ttlMs);
    try {
      return await fn();
    } finally {
      this.localLocks.delete(key);
    }
  }

  // ------------------------------------------------------------- Cache

  async getJson<T>(key: string): Promise<T | null> {
    let raw: string | null = null;
    if (this.client) raw = await this.safe((c) => c.get(`cache:${key}`), () => null);
    else {
      const hit = this.localCache.get(key);
      raw = hit && hit.until > Date.now() ? hit.value : null;
    }
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    const raw = JSON.stringify(value);
    if (this.client) await this.safe((c) => c.set(`cache:${key}`, raw, 'EX', ttlSeconds), () => null);
    else this.localCache.set(key, { value: raw, until: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string) {
    if (this.client) await this.safe((c) => c.del(`cache:${key}`), () => 0);
    this.localCache.delete(key);
  }

  private localIncr(key: string, windowSeconds: number) {
    const hit = this.localCache.get(`ctr:${key}`);
    const live = hit && hit.until > Date.now();
    const n = live ? Number(hit.value) + 1 : 1;
    this.localCache.set(`ctr:${key}`, { value: String(n), until: live ? hit.until : Date.now() + windowSeconds * 1000 });
    return n;
  }

  private localCounter(key: string) {
    const hit = this.localCache.get(`ctr:${key}`);
    return hit && hit.until > Date.now() ? Number(hit.value) : 0;
  }

  /** Fixed-window counter; returns the count after incrementing. Falls back to a per-process counter if Redis is down. */
  async incr(key: string, windowSeconds: number) {
    if (!this.client) return this.localIncr(key, windowSeconds);
    return this.safe(
      async (c) => {
        const k = `ctr:${key}`;
        const n = await c.incr(k);
        if (n === 1) await c.expire(k, windowSeconds);
        return n;
      },
      () => this.localIncr(key, windowSeconds),
    );
  }

  /** Current value of an `incr` counter without incrementing it. */
  async counter(key: string) {
    if (!this.client) return this.localCounter(key);
    return this.safe(async (c) => Number((await c.get(`ctr:${key}`)) ?? 0), () => this.localCounter(key));
  }

  async resetCounter(key: string) {
    this.localCache.delete(`ctr:${key}`);
    if (this.client) await this.safe((c) => c.del(`ctr:${key}`), () => 0);
  }

  // ------------------------------------------------------------- Pub/sub

  async publish(channel: string, payload: unknown) {
    const deliverLocally = () => {
      setImmediate(() => this.local.emit(channel, payload));
      return 0;
    };
    // With Redis up, our own subscriber hands the message back to local listeners (so do NOT also emit here: double delivery).
    // If Redis is down, cross-instance fan-out is lost but this instance's listeners still get the event.
    if (this.client) await this.safe((c) => c.publish(channel, JSON.stringify(payload)), deliverLocally);
    else deliverLocally();
  }

  async subscribe(channel: string, handler: (payload: unknown) => void) {
    this.local.on(channel, handler);
    if (this.sub) await this.sub.subscribe(channel);
  }

  async onModuleDestroy() {
    await Promise.all([this.client?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
  }
}
