import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';

type Increment = ThrottlerStorage['increment'];

/**
 * Rate limiting must never be able to take the API down. If the shared (Redis) store errors or times out, requests are
 * counted in this process instead (limits become per-replica, still protective) and Redis is skipped for a few seconds
 * so a Redis outage costs one slow request, not one per request.
 */
export class ResilientThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');
  private readonly fallback = new ThrottlerStorageService();
  private openUntil = 0;
  private lastLog = 0;

  constructor(private readonly primary: ThrottlerStorage) {}

  increment: Increment = async (...args) => {
    if (Date.now() < this.openUntil) return this.fallback.increment(...args);
    try {
      return await this.primary.increment(...args);
    } catch (e) {
      this.openUntil = Date.now() + 5_000;
      if (Date.now() - this.lastLog > 30_000) {
        this.lastLog = Date.now();
        this.logger.error(`Shared rate-limit store unavailable, using per-process counters: ${(e as Error).message}`);
      }
      return this.fallback.increment(...args);
    }
  };
}
