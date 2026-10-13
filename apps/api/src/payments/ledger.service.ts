import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';

/** Ledger accounts. Prize money owed to winners is tracked separately from platform revenue. */
export const Account = {
  GATEWAY_RECEIVABLE: 'GATEWAY_RECEIVABLE',
  GATEWAY_FEES: 'GATEWAY_FEES',
  PLATFORM_REVENUE: 'PLATFORM_REVENUE',
  PRIZE_POOL_LIABILITY: 'PRIZE_POOL_LIABILITY',
  PLATFORM_PRIZE_EXPENSE: 'PLATFORM_PRIZE_EXPENSE',
  SPONSOR_FUNDS: 'SPONSOR_FUNDS',
  PRIZES_PAYABLE: 'PRIZES_PAYABLE',
  PAYOUTS_BANK: 'PAYOUTS_BANK',
  /** Rupee value of coins students bought and have not yet spent. */
  COIN_LIABILITY_PURCHASED: 'COIN_LIABILITY_PURCHASED',
  /** Rupee value of coins students earned (prizes, duels, grants) and have not yet redeemed. */
  COIN_LIABILITY_EARNED: 'COIN_LIABILITY_EARNED',
  /** Bonus coins, grants and rewards costing more than the coins' value. */
  PLATFORM_PROMO_EXPENSE: 'PLATFORM_PROMO_EXPENSE',
  /** Rupee value of coins held for 1v1 duel rooms that have not been settled yet. */
  DUEL_ESCROW: 'DUEL_ESCROW',
} as const;
export type AccountName = (typeof Account)[keyof typeof Account];

export interface LedgerLine {
  account: AccountName;
  debit?: number;
  credit?: number;
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Post one balanced transaction. Throws if debits ≠ credits. Entries are immutable (DB trigger). */
  async post(lines: LedgerLine[], ctx: { memo: string; orderId?: string | null; tournamentId?: string | null }, tx: Tx = this.prisma) {
    const clean = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    const debit = clean.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = clean.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (debit !== credit) throw new Error(`Unbalanced ledger transaction: ${debit} ≠ ${credit}`);
    if (!clean.length) return null;
    const txnId = randomUUID();
    await tx.ledgerEntry.createMany({
      data: clean.map((l) => ({
        txnId,
        account: l.account,
        debitPaise: l.debit ?? 0,
        creditPaise: l.credit ?? 0,
        orderId: ctx.orderId ?? null,
        tournamentId: ctx.tournamentId ?? null,
        memo: ctx.memo,
      })),
    });
    return txnId;
  }

  async balances() {
    const rows = await this.prisma.ledgerEntry.groupBy({ by: ['account'], _sum: { debitPaise: true, creditPaise: true } });
    return rows.map((r) => ({
      account: r.account,
      debitPaise: r._sum.debitPaise ?? 0,
      creditPaise: r._sum.creditPaise ?? 0,
      /** Positive = net credit (revenue/liability style). */
      netCreditPaise: (r._sum.creditPaise ?? 0) - (r._sum.debitPaise ?? 0),
    }));
  }
}
