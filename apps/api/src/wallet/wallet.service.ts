import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Redemption, type RewardItem, type Wallet, type WalletTxnType } from '@prisma/client';
import {
  formatRupees,
  type AdminRedemptionDto,
  type CoinPackDto,
  type RedeemInput,
  type RedemptionActionInput,
  type RedemptionDto,
  type RewardDto,
  type ShippingAddress,
  type WalletAdjustInput,
  type WalletDto,
  type WalletTxnDto,
} from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { isMinor } from '../auth/user-mapper';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Account, LedgerService } from '../payments/ledger.service';

type Tx = Prisma.TransactionClient;
type Delta = { purchased?: number; earned?: number; held?: number };

const OPEN_REDEMPTION = ['PENDING', 'APPROVED'] as const;

export function toCoinPackDto(p: { id: string; titleEn: string; titleHi: string | null; coins: number; bonusCoins: number; pricePaise: number; badgeEn: string | null; badgeHi: string | null; active: boolean; sortOrder: number }): CoinPackDto {
  return { id: p.id, titleEn: p.titleEn, titleHi: p.titleHi, coins: p.coins, bonusCoins: p.bonusCoins, pricePaise: p.pricePaise, badgeEn: p.badgeEn, badgeHi: p.badgeHi, active: p.active, sortOrder: p.sortOrder };
}

/**
 * Coin wallet. Every balance change goes through `move`, which updates the Wallet row
 * atomically (a CHECK constraint forbids negative balances) and appends a WalletTxn.
 * Rupee value of outstanding coins is tracked on the money ledger as a liability.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------- Core

  private async ensure(userId: string, tx: Tx | PrismaService = this.prisma): Promise<Wallet> {
    return tx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  /** Apply a balance change and record it. Throws "Not enough coins" if any bucket would go negative. */
  async move(
    tx: Tx,
    userId: string,
    type: WalletTxnType,
    d: Delta,
    ctx: { memo: string; refType?: string; refId?: string; actorId?: string | null; idempotencyKey?: string },
  ) {
    if (ctx.idempotencyKey) {
      const seen = await tx.walletTxn.findUnique({ where: { idempotencyKey: ctx.idempotencyKey } });
      if (seen) return { ...seen, replayed: true };
    }
    await this.ensure(userId, tx);
    const p = d.purchased ?? 0;
    const e = d.earned ?? 0;
    const h = d.held ?? 0;
    let w: Wallet;
    try {
      w = await tx.wallet.update({
        where: { userId },
        data: {
          purchased: { increment: p },
          earned: { increment: e },
          held: { increment: h },
          ...(type === 'TOPUP' && { lifetimePurchased: { increment: p } }),
          ...((type === 'EARN_PRIZE' || type === 'EARN_DUEL' || type === 'DUEL_PRIZE' || type === 'GAME_REWARD' || (type === 'ADMIN_CREDIT' && e > 0)) && { lifetimeEarned: { increment: e } }),
        },
      });
    } catch (err) {
      if (String((err as Error).message).includes('wallet_non_negative')) throw new BadRequestException('Not enough coins');
      throw err;
    }
    const txn = await tx.walletTxn.create({
      data: {
        userId, type, purchasedDelta: p, earnedDelta: e, heldDelta: h,
        purchasedAfter: w.purchased, earnedAfter: w.earned, heldAfter: w.held,
        memo: ctx.memo, refType: ctx.refType ?? null, refId: ctx.refId ?? null, actorId: ctx.actorId ?? null, idempotencyKey: ctx.idempotencyKey ?? null,
      },
    });
    return { ...txn, replayed: false };
  }

  async settings() {
    return this.config.get('wallet.settings');
  }

  private async requireEnabled() {
    const s = await this.settings();
    if (!s.enabled) throw new ForbiddenException('The wallet is not available yet');
    return s;
  }

  async wallet(userId: string): Promise<WalletDto> {
    const [w, s] = await Promise.all([this.ensure(userId), this.settings()]);
    return {
      purchased: w.purchased, earned: w.earned, held: w.held, available: w.purchased + w.earned, withdrawable: w.earned,
      frozen: w.frozen, frozenReason: w.frozenReason, coinValuePaise: s.coinValuePaise,
    };
  }

  async transactions(userId: string, before?: string): Promise<WalletTxnDto[]> {
    const rows = await this.prisma.walletTxn.findMany({
      where: { userId, ...(before && { createdAt: { lt: new Date(before) } }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((t) => ({ id: t.id, type: t.type, purchasedDelta: t.purchasedDelta, earnedDelta: t.earnedDelta, heldDelta: t.heldDelta, memo: t.memo, refType: t.refType, refId: t.refId, createdAt: t.createdAt.toISOString() }));
  }

  // ------------------------------------------------------------- Earning

  /**
   * Credit earned coins (prizes, duel wins, admin grants). `source` is the ledger account
   * the value is charged to: platform promotion budget by default, or prizes payable.
   */
  async earn(
    tx: Tx,
    userId: string,
    coins: number,
    type: 'EARN_PRIZE' | 'EARN_DUEL' | 'ADMIN_CREDIT' | 'GAME_REWARD',
    ctx: { memo: string; refType?: string; refId?: string; actorId?: string | null; idempotencyKey?: string; tournamentId?: string | null; source?: typeof Account.PRIZES_PAYABLE | typeof Account.PLATFORM_PROMO_EXPENSE },
  ) {
    if (coins <= 0) return null;
    const { coinValuePaise } = await this.settings();
    const txn = await this.move(tx, userId, type, { earned: coins }, ctx);
    if (!txn.replayed) {
      await this.ledger.post(
        [
          { account: ctx.source ?? Account.PLATFORM_PROMO_EXPENSE, debit: coins * coinValuePaise },
          { account: Account.COIN_LIABILITY_EARNED, credit: coins * coinValuePaise },
        ],
        { memo: `${type.toLowerCase()} ${ctx.memo}`, tournamentId: ctx.tournamentId ?? null },
        tx,
      );
    }
    return txn;
  }

  // ------------------------------------------------------------- Duel escrow (server-side only)

  /**
   * Take a duel entry fee into escrow. Every amount comes from the room row on the server; the app only names the
   * room. `source` decides which coins may pay: earned coins come from play, purchased coins from real money.
   * One entry per (room, user): a replay returns the original split and moves nothing.
   */
  async holdDuelEntry(tx: Tx, userId: string, roomId: string, cycle: number, coins: number, source: 'EARNED_ONLY' | 'EARNED_FIRST' | 'ANY') {
    const key = `duel:entry:${roomId}:${cycle}:${userId}`;
    const w = await this.ensure(userId, tx);
    if (w.frozen) throw new ForbiddenException('Your wallet is frozen. Contact support.');
    const seen = await tx.walletTxn.findUnique({ where: { idempotencyKey: key } });
    if (seen) return { fromPurchased: -seen.purchasedDelta, fromEarned: -seen.earnedDelta, balance: w.purchased + w.earned, replayed: true };
    let fromEarned: number;
    let fromPurchased: number;
    if (source === 'EARNED_ONLY') {
      if (w.earned < coins) throw new BadRequestException('You need more earned coins to enter this duel. Earn coins by learning and playing.');
      fromEarned = coins;
      fromPurchased = 0;
    } else if (source === 'EARNED_FIRST') {
      fromEarned = Math.min(w.earned, coins);
      fromPurchased = coins - fromEarned;
    } else {
      fromPurchased = Math.min(w.purchased, coins);
      fromEarned = coins - fromPurchased;
    }
    if (fromPurchased > w.purchased || fromEarned > w.earned) throw new BadRequestException('Not enough coins');
    const { coinValuePaise } = await this.settings();
    const txn = await this.move(tx, userId, 'DUEL_ENTRY', { purchased: -fromPurchased, earned: -fromEarned }, { memo: 'Duel entry', refType: 'DuelRoom', refId: roomId, idempotencyKey: key });
    await this.ledger.post(
      [
        { account: Account.COIN_LIABILITY_PURCHASED, debit: fromPurchased * coinValuePaise },
        { account: Account.COIN_LIABILITY_EARNED, debit: fromEarned * coinValuePaise },
        { account: Account.DUEL_ESCROW, credit: coins * coinValuePaise },
      ],
      { memo: `duel entry ${roomId}` },
      tx,
    );
    return { fromPurchased, fromEarned, balance: txn.purchasedAfter + txn.earnedAfter, replayed: false };
  }

  /** Give a held entry back to the same buckets it came from. A no-op if there is no entry or it was already returned. */
  async refundDuelEntry(tx: Tx, userId: string, roomId: string, cycle: number, memo = 'Duel entry refunded') {
    const entry = await tx.walletTxn.findUnique({ where: { idempotencyKey: `duel:entry:${roomId}:${cycle}:${userId}` } });
    if (!entry) return null;
    const { coinValuePaise } = await this.settings();
    const back = { purchased: -entry.purchasedDelta, earned: -entry.earnedDelta };
    const txn = await this.move(tx, userId, 'DUEL_REFUND', back, { memo, refType: 'DuelRoom', refId: roomId, idempotencyKey: `duel:refund:${roomId}:${cycle}:${userId}` });
    if (!txn.replayed) {
      await this.ledger.post(
        [
          { account: Account.DUEL_ESCROW, debit: (back.purchased + back.earned) * coinValuePaise },
          { account: Account.COIN_LIABILITY_PURCHASED, credit: back.purchased * coinValuePaise },
          { account: Account.COIN_LIABILITY_EARNED, credit: back.earned * coinValuePaise },
        ],
        { memo: `duel refund ${roomId}` },
        tx,
      );
    }
    return txn;
  }

  /** Pay the winner from escrow. The part of the pool that is not paid out is the platform fee. */
  async payDuelPrize(tx: Tx, winnerId: string, roomId: string, cycle: number, prize: number, poolCoins: number) {
    const { coinValuePaise } = await this.settings();
    const txn = await this.move(tx, winnerId, 'DUEL_PRIZE', { earned: prize }, { memo: 'Duel prize', refType: 'DuelRoom', refId: roomId, idempotencyKey: `duel:prize:${roomId}:${cycle}` });
    if (!txn.replayed) {
      await this.ledger.post(
        [
          { account: Account.DUEL_ESCROW, debit: poolCoins * coinValuePaise },
          { account: Account.COIN_LIABILITY_EARNED, credit: prize * coinValuePaise },
          { account: Account.PLATFORM_REVENUE, credit: (poolCoins - prize) * coinValuePaise },
        ],
        { memo: `duel prize ${roomId}` },
        tx,
      );
    }
    return txn;
  }

  /** Coins taken into escrow today (India time) by this student, for the daily duel limits. */
  async duelEntriesToday(userId: string, since: Date) {
    const rows = await this.prisma.walletTxn.findMany({ where: { userId, type: 'DUEL_ENTRY', createdAt: { gte: since } }, select: { purchasedDelta: true, earnedDelta: true } });
    return { count: rows.length, coins: rows.reduce((n, r) => n - r.purchasedDelta - r.earnedDelta, 0) };
  }

  // ------------------------------------------------------------- Top-ups

  async packs(all = false) {
    const rows = await this.prisma.coinPack.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { pricePaise: 'asc' }] });
    return rows.map(toCoinPackDto);
  }

  /** Checks before creating a top-up order. Returns the pack. */
  async assertCanTopUp(userId: string, packId: string) {
    const s = await this.requireEnabled();
    if (!s.topUpEnabled) throw new ForbiddenException('Top-ups are paused');
    const pack = await this.prisma.coinPack.findUnique({ where: { id: packId } });
    if (!pack || !pack.active) throw new NotFoundException('Coin pack not available');
    const [user, w, age] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: userId } }), this.ensure(userId), this.config.get('policy.age')]);
    if (w.frozen) throw new ForbiddenException('Your wallet is frozen. Contact support.');
    if (isMinor(user, age.adultAge) && !s.minorTopUpAllowed) throw new ForbiddenException('Coin top-ups are available only to adult accounts');
    const since = new Date(Date.now() - 86_400_000);
    const spent = await this.prisma.order.aggregate({ where: { userId, kind: 'COIN_TOPUP', status: { in: ['PAID', 'CREATED'] }, createdAt: { gte: since } }, _sum: { amountPaise: true } });
    if ((spent._sum.amountPaise ?? 0) + pack.pricePaise > s.maxTopUpPaisePerDay) {
      throw new ForbiddenException(`Daily top-up limit is ${formatRupees(s.maxTopUpPaisePerDay)}`);
    }
    return pack;
  }

  /** Called by PaymentsService inside the capture transaction. */
  async fulfilTopUp(tx: Tx, order: { id: string; userId: string; refId: string; amountPaise: number; receiptNo: string }) {
    const pack = await tx.coinPack.findUniqueOrThrow({ where: { id: order.refId } });
    const coins = pack.coins + pack.bonusCoins;
    const { coinValuePaise } = await this.settings();
    const txn = await this.move(tx, order.userId, 'TOPUP', { purchased: coins }, { memo: `Top-up ${pack.titleEn}`, refType: 'Order', refId: order.id, idempotencyKey: `topup:${order.id}` });
    if (txn.replayed) return;
    // Payment capture credited COIN_LIABILITY_PURCHASED with the price; true it up to the coins' value.
    const diff = coins * coinValuePaise - order.amountPaise;
    if (diff > 0) {
      await this.ledger.post([{ account: Account.PLATFORM_PROMO_EXPENSE, debit: diff }, { account: Account.COIN_LIABILITY_PURCHASED, credit: diff }], { memo: `top-up bonus ${order.receiptNo}`, orderId: order.id }, tx);
    } else if (diff < 0) {
      await this.ledger.post([{ account: Account.COIN_LIABILITY_PURCHASED, debit: -diff }, { account: Account.PLATFORM_REVENUE, credit: -diff }], { memo: `top-up margin ${order.receiptNo}`, orderId: order.id }, tx);
    }
    await this.notifications.event('COINS_TOPPED_UP', order.userId, { coins, amount: formatRupees(order.amountPaise) }, { link: '/wallet', tx });
  }

  /** A top-up can be refunded only while its coins are unspent. */
  async assertTopUpRefundable(order: { id: string; userId: string; refId: string }) {
    const txn = await this.prisma.walletTxn.findUnique({ where: { idempotencyKey: `topup:${order.id}` } });
    if (!txn) return;
    const w = await this.ensure(order.userId);
    if (w.purchased < txn.purchasedDelta) throw new ConflictException('These coins have already been spent, so this top-up cannot be refunded');
  }

  async reverseTopUp(tx: Tx, order: { id: string; userId: string; amountPaise: number; receiptNo: string }) {
    const txn = await tx.walletTxn.findUnique({ where: { idempotencyKey: `topup:${order.id}` } });
    if (!txn) return;
    const { coinValuePaise } = await this.settings();
    await this.move(tx, order.userId, 'TOPUP_REFUND', { purchased: -txn.purchasedDelta }, { memo: `Top-up refunded ${order.receiptNo}`, refType: 'Order', refId: order.id, idempotencyKey: `topup-refund:${order.id}` });
    // The refund itself reverses capture → liability; reverse the bonus/margin true-up too.
    const diff = txn.purchasedDelta * coinValuePaise - order.amountPaise;
    if (diff > 0) await this.ledger.post([{ account: Account.COIN_LIABILITY_PURCHASED, debit: diff }, { account: Account.PLATFORM_PROMO_EXPENSE, credit: diff }], { memo: `top-up bonus reversed ${order.receiptNo}`, orderId: order.id }, tx);
    else if (diff < 0) await this.ledger.post([{ account: Account.PLATFORM_REVENUE, debit: -diff }, { account: Account.COIN_LIABILITY_PURCHASED, credit: -diff }], { memo: `top-up margin reversed ${order.receiptNo}`, orderId: order.id }, tx);
    await this.notifications.event('COINS_DEBITED', order.userId, { coins: txn.purchasedDelta, reason: { en: `Top-up ${order.receiptNo} was refunded.`, hi: `टॉप-अप ${order.receiptNo} का रिफंड हुआ।` } }, { link: '/wallet', tx });
  }

  // ------------------------------------------------------------- Rewards catalog

  private async stockLeft(r: RewardItem): Promise<number | null> {
    if (r.kind === 'VOUCHER') {
      const codes = await this.prisma.voucherCode.count({ where: { rewardId: r.id } });
      if (codes > 0) return this.prisma.voucherCode.count({ where: { rewardId: r.id, redemptionId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    }
    return r.stock;
  }

  async rewardDto(r: RewardItem): Promise<RewardDto> {
    const left = await this.stockLeft(r);
    return {
      id: r.id, kind: r.kind, titleEn: r.titleEn, titleHi: r.titleHi, descriptionEn: r.descriptionEn, descriptionHi: r.descriptionHi,
      termsEn: r.termsEn, termsHi: r.termsHi, imageUrl: r.imageUrl, brand: r.brand, coinCost: r.coinCost, valuePaise: r.valuePaise,
      variants: r.variants, requiresAddress: r.requiresAddress, requiresUpi: r.kind === 'UPI_CASH', allowPurchasedCoins: r.allowPurchasedCoins && r.kind !== 'UPI_CASH',
      inStock: left === null || left > 0, stockLeft: left, perUserLimit: r.perUserLimit, active: r.active, sortOrder: r.sortOrder,
    };
  }

  async rewards(all = false) {
    const s = await this.settings();
    const money = await this.config.get('policy.money');
    const rows = await this.prisma.rewardItem.findMany({ where: all ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { coinCost: 'asc' }] });
    const visible = all ? rows : rows.filter((r) => r.kind !== 'UPI_CASH' || (s.upiPayoutsEnabled && money.cashRewardsEnabled));
    return Promise.all(visible.map((r) => this.rewardDto(r)));
  }

  // ------------------------------------------------------------- Redemption

  private toRedemptionDto(r: Redemption & { reward: RewardItem }, reveal: boolean): RedemptionDto {
    return {
      id: r.id, reward: { id: r.reward.id, kind: r.reward.kind, titleEn: r.reward.titleEn, titleHi: r.reward.titleHi, imageUrl: r.reward.imageUrl },
      coins: r.coins, fromPurchased: r.fromPurchased, fromEarned: r.fromEarned, status: r.status, variant: r.variant,
      shippingAddress: (r.shippingAddress as ShippingAddress | null) ?? null, upiVpa: r.upiVpa,
      // Voucher codes are revealed only once fulfilled.
      voucherCode: reveal && r.status === 'FULFILLED' ? r.voucherCode : null,
      voucherPin: reveal && r.status === 'FULFILLED' ? r.voucherPin : null,
      payoutRef: r.payoutRef, carrier: r.carrier, trackingNo: r.trackingNo, rejectReason: r.rejectReason,
      createdAt: r.createdAt.toISOString(), fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
    };
  }

  async myRedemptions(userId: string) {
    const rows = await this.prisma.redemption.findMany({ where: { userId }, include: { reward: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => this.toRedemptionDto(r, true));
  }

  async redeem(userId: string, input: RedeemInput): Promise<RedemptionDto> {
    const existing = await this.prisma.redemption.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { reward: true } });
    if (existing) {
      if (existing.userId !== userId) throw new ConflictException('Idempotency key reused');
      return this.toRedemptionDto(existing, true);
    }
    const s = await this.requireEnabled();
    if (!s.redemptionsEnabled) throw new ForbiddenException('Redemptions are paused');
    const reward = await this.prisma.rewardItem.findUnique({ where: { id: input.rewardId } });
    if (!reward || !reward.active) throw new NotFoundException('Reward not available');
    const [user, w, age, money] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.ensure(userId),
      this.config.get('policy.age'),
      this.config.get('policy.money'),
    ]);
    if (w.frozen) throw new ForbiddenException('Your wallet is frozen. Contact support.');
    const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
    if (ageDays < s.minAccountAgeDays) throw new ForbiddenException(`Rewards unlock ${s.minAccountAgeDays} days after you join`);
    const isUpi = reward.kind === 'UPI_CASH';
    if (isUpi) {
      if (!s.upiPayoutsEnabled || !money.cashRewardsEnabled) throw new ForbiddenException('UPI payouts are not available');
      if (isMinor(user, age.adultAge)) throw new ForbiddenException('UPI payouts are available only to adult accounts');
      if (!input.upiVpa) throw new BadRequestException('Enter your UPI ID');
    }
    if (reward.requiresAddress && !input.shippingAddress) throw new BadRequestException('Enter a delivery address');
    if (reward.variants.length && (!input.variant || !reward.variants.includes(input.variant))) throw new BadRequestException(`Choose one of: ${reward.variants.join(', ')}`);
    const today = new Date(Date.now() - 86_400_000);
    const recent = await this.prisma.redemption.count({ where: { userId, createdAt: { gte: today }, status: { notIn: ['REJECTED', 'CANCELLED', 'FAILED'] } } });
    if (recent >= s.maxRedemptionsPerDay) throw new ForbiddenException(`You can redeem up to ${s.maxRedemptionsPerDay} rewards a day`);
    if (reward.perUserLimit) {
      const mine = await this.prisma.redemption.count({ where: { userId, rewardId: reward.id, status: { notIn: ['REJECTED', 'CANCELLED', 'FAILED'] } } });
      if (mine >= reward.perUserLimit) throw new ForbiddenException('You have reached the limit for this reward');
    }

    // Spend purchased coins first (when allowed) so earned coins stay withdrawable.
    const canUsePurchased = reward.allowPurchasedCoins && !isUpi;
    const fromPurchased = canUsePurchased ? Math.min(w.purchased, reward.coinCost) : 0;
    const fromEarned = reward.coinCost - fromPurchased;
    if (fromEarned > w.earned) {
      throw new BadRequestException(canUsePurchased ? 'Not enough coins' : 'Not enough earned coins. Purchased coins cannot be used for this reward.');
    }

    const autoApprove = !isUpi && (reward.autoApprove || (s.autoApproveBelowCoins > 0 && reward.coinCost <= s.autoApproveBelowCoins));
    const created = await this.prisma.$transaction(async (tx) => {
      // Reserve stock: a voucher code, or a unit of counted stock.
      let codeId: string | null = null;
      const codes = reward.kind === 'VOUCHER' ? await tx.voucherCode.count({ where: { rewardId: reward.id } }) : 0;
      if (codes > 0) {
        const free = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "VoucherCode" WHERE "rewardId" = ${reward.id} AND "redemptionId" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())
          ORDER BY "expiresAt" ASC NULLS LAST, "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!free.length) throw new ConflictException('Out of stock');
        codeId = free[0].id;
      } else if (reward.stock !== null) {
        const res = await tx.rewardItem.updateMany({ where: { id: reward.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (!res.count) throw new ConflictException('Out of stock');
      }
      const r = await tx.redemption.create({
        data: {
          userId, rewardId: reward.id, coins: reward.coinCost, fromPurchased, fromEarned, variant: input.variant ?? null,
          shippingAddress: input.shippingAddress ? (input.shippingAddress as Prisma.InputJsonValue) : Prisma.DbNull,
          upiVpa: isUpi ? input.upiVpa! : null, costPaise: isUpi ? reward.valuePaise : reward.costPaise, idempotencyKey: input.idempotencyKey,
          status: autoApprove ? 'APPROVED' : 'PENDING', reviewedAt: autoApprove ? new Date() : null, reviewedById: autoApprove ? 'SYSTEM' : null,
        },
      });
      if (codeId) {
        const code = await tx.voucherCode.update({ where: { id: codeId }, data: { redemptionId: r.id } });
        await tx.redemption.update({ where: { id: r.id }, data: { voucherCode: code.code, voucherPin: code.pin } });
      }
      await this.move(tx, userId, 'REDEEM_HOLD', { purchased: -fromPurchased, earned: -fromEarned, held: reward.coinCost }, { memo: `Hold for ${reward.titleEn}`, refType: 'Redemption', refId: r.id });
      await this.notifications.event('REDEMPTION_REQUESTED', userId, { reward: { en: reward.titleEn, hi: reward.titleHi }, coins: reward.coinCost }, { link: '/wallet/redemptions', tx });
      return r;
    });

    // Instant vouchers: approved automatically and a code was reserved, so deliver now.
    if (autoApprove && created && reward.kind === 'VOUCHER') {
      const withCode = await this.prisma.redemption.findUniqueOrThrow({ where: { id: created.id } });
      if (withCode.voucherCode) await this.act(created.id, { action: 'FULFILL' }, { type: 'SYSTEM' });
    }
    const full = await this.prisma.redemption.findUniqueOrThrow({ where: { id: created.id }, include: { reward: true } });
    return this.toRedemptionDto(full, true);
  }

  async cancel(userId: string, id: string) {
    const r = await this.prisma.redemption.findUnique({ where: { id } });
    if (!r || r.userId !== userId) throw new NotFoundException('Redemption not found');
    if (r.status !== 'PENDING') throw new ConflictException('Only pending requests can be cancelled');
    await this.close(r.id, 'CANCELLED', 'Cancelled by you', { type: 'USER', id: userId });
    return { ok: true };
  }

  /** Reject / cancel / fail: return held coins and reserved stock. */
  private async close(id: string, status: 'REJECTED' | 'CANCELLED' | 'FAILED', reason: string, actor: AuditActor) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.redemption.findUniqueOrThrow({ where: { id }, include: { reward: true } });
      const res = await tx.redemption.updateMany({ where: { id, status: { in: [...OPEN_REDEMPTION] } }, data: { status, rejectReason: reason, reviewedAt: new Date(), reviewedById: actor.id ?? actor.type } });
      if (!res.count) throw new ConflictException(`Redemption is already ${r.status.toLowerCase()}`);
      await this.move(tx, r.userId, 'REDEEM_RELEASE', { purchased: r.fromPurchased, earned: r.fromEarned, held: -r.coins }, { memo: `Returned: ${r.reward.titleEn}`, refType: 'Redemption', refId: r.id });
      const freed = await tx.voucherCode.updateMany({ where: { redemptionId: r.id }, data: { redemptionId: null } });
      if (!freed.count && r.reward.stock !== null) await tx.rewardItem.update({ where: { id: r.rewardId }, data: { stock: { increment: 1 } } });
      if (freed.count) await tx.redemption.update({ where: { id: r.id }, data: { voucherCode: null, voucherPin: null } });
      if (status !== 'CANCELLED') {
        await this.notifications.event('REDEMPTION_REJECTED', r.userId, { reward: { en: r.reward.titleEn, hi: r.reward.titleHi }, reason }, { link: '/wallet/redemptions', tx });
      }
      await this.audit.log(actor, { action: `redemption.${status.toLowerCase()}`, entityType: 'Redemption', entityId: r.id, meta: { reason } }, tx);
    });
  }

  /** Admin workflow. Large UPI payouts need the approver and the fulfiller to be different admins. */
  async act(id: string, input: RedemptionActionInput | { action: 'FULFILL' }, actor: AuditActor) {
    const r = await this.prisma.redemption.findUnique({ where: { id }, include: { reward: true } });
    if (!r) throw new NotFoundException('Redemption not found');
    if (input.action === 'REJECT') return this.close(id, 'REJECTED', input.reason, actor).then(() => this.adminDto(id));
    if (input.action === 'FAIL') {
      if (r.status !== 'APPROVED') throw new ConflictException('Only approved redemptions can be marked failed');
      return this.close(id, 'FAILED', input.reason, actor).then(() => this.adminDto(id));
    }
    if (input.action === 'APPROVE') {
      const res = await this.prisma.redemption.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date(), adminNote: input.note ?? r.adminNote } });
      if (!res.count) throw new ConflictException(`Redemption is ${r.status.toLowerCase()}`);
      await this.audit.log(actor, { action: 'redemption.approve', entityType: 'Redemption', entityId: id, meta: { note: input.note } });
      await this.notifications.event('REDEMPTION_APPROVED', r.userId, { reward: { en: r.reward.titleEn, hi: r.reward.titleHi } }, { link: '/wallet/redemptions' });
      return this.adminDto(id);
    }

    // FULFILL
    const f = input as Extract<RedemptionActionInput, { action: 'FULFILL' }>;
    if (!OPEN_REDEMPTION.includes(r.status as (typeof OPEN_REDEMPTION)[number])) throw new ConflictException(`Redemption is ${r.status.toLowerCase()}`);
    if (r.reward.kind === 'UPI_CASH') {
      if (!f.payoutRef) throw new BadRequestException('UPI transaction reference is required');
      if (r.status !== 'APPROVED') throw new ConflictException('Approve the payout before marking it paid');
      const { refundDualApprovalAbovePaise } = await this.config.get('payments.policy');
      if (r.costPaise > refundDualApprovalAbovePaise && r.reviewedById === actor.id) throw new ForbiddenException('A different admin must confirm this payout');
    }
    const voucherCode = f.voucherCode ?? r.voucherCode;
    if (r.reward.kind === 'VOUCHER' && !voucherCode) throw new BadRequestException('Voucher code is required');
    const { coinValuePaise } = await this.settings();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.redemption.updateMany({
        where: { id, status: { in: [...OPEN_REDEMPTION] } },
        data: {
          status: 'FULFILLED', fulfilledAt: new Date(), payoutRef: f.payoutRef ?? null, carrier: f.carrier ?? null, trackingNo: f.trackingNo ?? null,
          voucherCode, voucherPin: f.voucherPin ?? r.voucherPin, adminNote: f.note ?? r.adminNote,
          ...(r.status === 'PENDING' && { reviewedById: actor.id ?? 'SYSTEM', reviewedAt: new Date() }),
        },
      });
      if (!res.count) throw new ConflictException('Redemption changed, reload');
      await this.move(tx, r.userId, 'REDEEM_SETTLE', { held: -r.coins }, { memo: `Redeemed: ${r.reward.titleEn}`, refType: 'Redemption', refId: r.id, actorId: actor.id });
      const vp = r.fromPurchased * coinValuePaise;
      const ve = r.fromEarned * coinValuePaise;
      const margin = vp + ve - r.costPaise;
      await this.ledger.post(
        [
          { account: Account.COIN_LIABILITY_PURCHASED, debit: vp },
          { account: Account.COIN_LIABILITY_EARNED, debit: ve },
          { account: Account.PLATFORM_PROMO_EXPENSE, debit: margin < 0 ? -margin : 0 },
          { account: Account.PAYOUTS_BANK, credit: r.costPaise },
          { account: Account.PLATFORM_REVENUE, credit: margin > 0 ? margin : 0 },
        ],
        { memo: `redemption ${r.reward.kind.toLowerCase()} ${r.id}${f.payoutRef ? ` ${f.payoutRef}` : ''}` },
        tx,
      );
      const detail =
        r.reward.kind === 'UPI_CASH'
          ? { en: `${formatRupees(r.costPaise)} sent to ${r.upiVpa}. UPI ref ${f.payoutRef}.`, hi: `${formatRupees(r.costPaise)} ${r.upiVpa} पर भेजे गए। UPI संदर्भ ${f.payoutRef}।` }
          : r.reward.kind === 'VOUCHER'
            ? { en: 'Your voucher code is ready in Wallet → My rewards.', hi: 'आपका वाउचर कोड वॉलेट → मेरे पुरस्कार में है।' }
            : f.trackingNo
              ? { en: `Shipped via ${f.carrier ?? 'courier'}, tracking ${f.trackingNo}.`, hi: `${f.carrier ?? 'कूरियर'} से भेजा गया, ट्रैकिंग ${f.trackingNo}।` }
              : { en: 'Your reward has been delivered.', hi: 'आपका पुरस्कार भेज दिया गया है।' };
      await this.notifications.event('REDEMPTION_FULFILLED', r.userId, { reward: { en: r.reward.titleEn, hi: r.reward.titleHi }, detail }, { link: '/wallet/redemptions', tx });
      await this.audit.log(actor, { action: 'redemption.fulfill', entityType: 'Redemption', entityId: id, meta: { payoutRef: f.payoutRef, trackingNo: f.trackingNo } }, tx);
    });
    return this.adminDto(id);
  }

  // ------------------------------------------------------------- Admin

  async adminDto(id: string): Promise<AdminRedemptionDto> {
    const r = await this.prisma.redemption.findUniqueOrThrow({ where: { id }, include: { reward: true, user: { select: { id: true, displayName: true, email: true, phone: true } } } });
    return { ...this.toRedemptionDto(r, true), voucherCode: r.voucherCode, voucherPin: r.voucherPin, user: r.user, adminNote: r.adminNote, reviewedById: r.reviewedById, reviewedAt: r.reviewedAt?.toISOString() ?? null, costPaise: r.costPaise };
  }

  async adminRedemptions(q: { status?: string; kind?: string; userId?: string }) {
    const rows = await this.prisma.redemption.findMany({
      where: { ...(q.status && { status: q.status as Redemption['status'] }), ...(q.kind && { reward: { kind: q.kind as RewardItem['kind'] } }), ...(q.userId && { userId: q.userId }) },
      include: { reward: true, user: { select: { id: true, displayName: true, email: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    return rows.map((r) => ({ ...this.toRedemptionDto(r, true), voucherCode: r.voucherCode, voucherPin: r.voucherPin, user: r.user, adminNote: r.adminNote, reviewedById: r.reviewedById, reviewedAt: r.reviewedAt?.toISOString() ?? null, costPaise: r.costPaise }));
  }

  async adjust(userId: string, input: WalletAdjustInput, actor: AuditActor) {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { coinValuePaise } = await this.settings();
    const value = Math.abs(input.amount) * coinValuePaise;
    const liability = input.bucket === 'EARNED' ? Account.COIN_LIABILITY_EARNED : Account.COIN_LIABILITY_PURCHASED;
    await this.prisma.$transaction(async (tx) => {
      const credit = input.amount > 0;
      await this.move(tx, userId, credit ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT', input.bucket === 'EARNED' ? { earned: input.amount } : { purchased: input.amount }, { memo: input.reason, actorId: actor.id });
      await this.ledger.post(
        credit
          ? [{ account: Account.PLATFORM_PROMO_EXPENSE, debit: value }, { account: liability, credit: value }]
          : [{ account: liability, debit: value }, { account: Account.PLATFORM_PROMO_EXPENSE, credit: value }],
        { memo: `wallet adjust ${userId}: ${input.reason}` },
        tx,
      );
      await this.audit.log(actor, { action: 'wallet.adjust', entityType: 'User', entityId: userId, meta: { bucket: input.bucket, amount: input.amount, reason: input.reason } }, tx);
      if (input.notify) {
        await this.notifications.event(credit ? 'COINS_CREDITED' : 'COINS_DEBITED', userId, { coins: Math.abs(input.amount), reason: input.reason }, { link: '/wallet', tx });
      }
    });
    return this.wallet(userId);
  }

  async freeze(userId: string, frozen: boolean, reason: string | null | undefined, actor: AuditActor) {
    await this.ensure(userId);
    await this.prisma.wallet.update({ where: { userId }, data: { frozen, frozenReason: frozen ? reason ?? null : null } });
    await this.audit.log(actor, { action: frozen ? 'wallet.freeze' : 'wallet.unfreeze', entityType: 'User', entityId: userId, meta: { reason } });
    return this.wallet(userId);
  }

  async overview() {
    const [totals, pending, byStatus, topups, s] = await Promise.all([
      this.prisma.wallet.aggregate({ _sum: { purchased: true, earned: true, held: true }, _count: true }),
      this.prisma.redemption.count({ where: { status: 'PENDING' } }),
      this.prisma.redemption.groupBy({ by: ['status'], _count: true, _sum: { coins: true, costPaise: true } }),
      this.prisma.order.aggregate({ where: { kind: 'COIN_TOPUP', status: 'PAID' }, _sum: { amountPaise: true }, _count: true }),
      this.settings(),
    ]);
    const balances = await this.ledger.balances();
    const bal = (a: string) => balances.find((b) => b.account === a)?.netCreditPaise ?? 0;
    return {
      wallets: totals._count,
      purchased: totals._sum.purchased ?? 0,
      earned: totals._sum.earned ?? 0,
      held: totals._sum.held ?? 0,
      outstandingValuePaise: ((totals._sum.purchased ?? 0) + (totals._sum.earned ?? 0) + (totals._sum.held ?? 0)) * s.coinValuePaise,
      ledgerLiabilityPaise: bal(Account.COIN_LIABILITY_PURCHASED) + bal(Account.COIN_LIABILITY_EARNED),
      pendingRedemptions: pending,
      redemptions: byStatus.map((b) => ({ status: b.status, count: b._count, coins: b._sum.coins ?? 0, costPaise: b._sum.costPaise ?? 0 })),
      topUps: { count: topups._count, amountPaise: topups._sum.amountPaise ?? 0 },
    };
  }

  async userWallet(userId: string) {
    const [w, txns, redemptions] = await Promise.all([this.wallet(userId), this.transactions(userId), this.adminRedemptions({ userId })]);
    return { wallet: w, transactions: txns, redemptions };
  }
}
