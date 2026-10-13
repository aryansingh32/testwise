import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * When the database is unreachable Prisma waits for a connection (5s default) and then for a pool slot (10s default), so
 * every request hangs 10-15s. Bound both so callers get a 503 + Retry-After quickly. Values already present in
 * DATABASE_URL always win.
 */
export function withTimeoutDefaults(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '3');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '8');
    return u.toString();
  } catch {
    return url; // let Prisma report the malformed URL
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Bursts (a tournament start/end) queue for pooled connections; wait longer than Prisma's 2s default before failing a transaction.
    super({ datasourceUrl: withTimeoutDefaults(process.env.DATABASE_URL), transactionOptions: { maxWait: 15_000, timeout: 20_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
