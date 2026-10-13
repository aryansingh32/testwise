import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Prisma, type User } from '@prisma/client';
import {
  coinPackSchema,
  Permission,
  redeemSchema,
  redemptionActionSchema,
  rewardSchema,
  topUpSchema,
  voucherCodesSchema,
  walletAdjustSchema,
  walletFreezeSchema,
  type CoinPackInput,
  type RedeemInput,
  type RedemptionActionInput,
  type RewardInput,
  type WalletAdjustInput,
} from '@testwise/shared';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentUser, RequirePermission, UserAuthGuard } from '../common/auth.guards';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { ZodPipe } from '../common/zod.pipe';
import { PaymentsService } from '../payments/payments.service';
import { toCoinPackDto, WalletService } from './wallet.service';

@Controller('v1/wallet')
@UseGuards(UserAuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async me(@CurrentUser() u: User) {
    return { wallet: await this.wallet.wallet(u.id), settings: await this.wallet.settings() };
  }

  @Get('transactions')
  txns(@CurrentUser() u: User, @Query('before') before?: string) {
    return this.wallet.transactions(u.id, before);
  }

  @Get('packs')
  packs() {
    return this.wallet.packs();
  }

  @Post('topup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async topUp(@CurrentUser() u: User, @Body(new ZodPipe(topUpSchema)) body: z.infer<typeof topUpSchema>) {
    const pack = await this.wallet.assertCanTopUp(u.id, body.packId);
    const order = await this.payments.singleFlight(body.idempotencyKey, () =>
      this.prisma.$transaction(async (tx) => {
        const o = await this.payments.createOrder(
          { userId: u.id, kind: 'COIN_TOPUP', refId: pack.id, descriptionEn: `${pack.coins + pack.bonusCoins} coins (${pack.titleEn})`, amountPaise: pack.pricePaise, idempotencyKey: body.idempotencyKey },
          tx,
        );
        if (o.status === 'PAID') await this.payments.fulfill(o.id, tx);
        return o;
      }),
    );
    return this.payments.checkout(order);
  }

  @Get('rewards')
  rewards() {
    return this.wallet.rewards();
  }

  @Post('redeem')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  redeem(@CurrentUser() u: User, @Body(new ZodPipe(redeemSchema)) body: RedeemInput) {
    return this.wallet.redeem(u.id, body);
  }

  @Get('redemptions')
  redemptions(@CurrentUser() u: User) {
    return this.wallet.myRedemptions(u.id);
  }

  @Post('redemptions/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: User, @Param('id') id: string) {
    return this.wallet.cancel(u.id, id);
  }
}

@Controller('v1/admin/wallet')
@UseGuards(AdminAuthGuard)
export class AdminWalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get('overview')
  @RequirePermission(Permission.WALLET_READ)
  overview() {
    return this.wallet.overview();
  }

  // ---------------- Coin packs

  @Get('packs')
  @RequirePermission(Permission.WALLET_READ)
  packs() {
    return this.wallet.packs(true);
  }

  @Post('packs')
  @RequirePermission(Permission.WALLET_WRITE)
  async createPack(@Body(new ZodPipe(coinPackSchema)) body: CoinPackInput, @AdminActor() actor: AuditActor) {
    const p = await this.prisma.coinPack.create({ data: body });
    await this.audit.log(actor, { action: 'coinpack.create', entityType: 'CoinPack', entityId: p.id, after: body });
    return toCoinPackDto(p);
  }

  @Put('packs/:id')
  @RequirePermission(Permission.WALLET_WRITE)
  async updatePack(@Param('id') id: string, @Body(new ZodPipe(coinPackSchema)) body: CoinPackInput, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.coinPack.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Pack not found');
    const p = await this.prisma.coinPack.update({ where: { id }, data: body });
    await this.audit.log(actor, { action: 'coinpack.update', entityType: 'CoinPack', entityId: id, before, after: body });
    return toCoinPackDto(p);
  }

  @Delete('packs/:id')
  @RequirePermission(Permission.WALLET_WRITE)
  async deletePack(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    // Orders reference packs by id, so packs are deactivated rather than deleted.
    await this.prisma.coinPack.update({ where: { id }, data: { active: false } });
    await this.audit.log(actor, { action: 'coinpack.deactivate', entityType: 'CoinPack', entityId: id });
    return { ok: true };
  }

  // ---------------- Rewards

  @Get('rewards')
  @RequirePermission(Permission.WALLET_READ)
  async rewards() {
    const rows = await this.prisma.rewardItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { coinCost: 'asc' }], include: { _count: { select: { codes: true, redemptions: true } } } });
    return Promise.all(
      rows.map(async (r) => ({
        ...(await this.wallet.rewardDto(r)),
        costPaise: r.costPaise,
        stock: r.stock,
        autoApprove: r.autoApprove,
        codesTotal: r._count.codes,
        redemptionsTotal: r._count.redemptions,
      })),
    );
  }

  @Post('rewards')
  @RequirePermission(Permission.WALLET_WRITE)
  async createReward(@Body(new ZodPipe(rewardSchema)) body: RewardInput, @AdminActor() actor: AuditActor) {
    const r = await this.prisma.rewardItem.create({ data: { ...body, requiresAddress: body.kind === 'MERCH' ? true : body.requiresAddress, costPaise: body.kind === 'UPI_CASH' ? body.valuePaise : body.costPaise } });
    await this.audit.log(actor, { action: 'reward.create', entityType: 'RewardItem', entityId: r.id, after: body });
    return this.wallet.rewardDto(r);
  }

  @Put('rewards/:id')
  @RequirePermission(Permission.WALLET_WRITE)
  async updateReward(@Param('id') id: string, @Body(new ZodPipe(rewardSchema)) body: RewardInput, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.rewardItem.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Reward not found');
    if (before.kind !== body.kind && (await this.prisma.redemption.count({ where: { rewardId: id } }))) throw new BadRequestException('Cannot change the type of a reward that has redemptions');
    const r = await this.prisma.rewardItem.update({ where: { id }, data: { ...body, requiresAddress: body.kind === 'MERCH' ? true : body.requiresAddress, costPaise: body.kind === 'UPI_CASH' ? body.valuePaise : body.costPaise } });
    await this.audit.log(actor, { action: 'reward.update', entityType: 'RewardItem', entityId: id, before, after: body });
    return this.wallet.rewardDto(r);
  }

  @Post('rewards/image')
  @RequirePermission(Permission.WALLET_WRITE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async image(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file');
    return { url: await this.storage.saveImage(file.originalname, file.buffer, 'rewards') };
  }

  @Get('rewards/:id/codes')
  @RequirePermission(Permission.WALLET_WRITE)
  async codes(@Param('id') id: string) {
    const [free, used, expired] = await Promise.all([
      this.prisma.voucherCode.count({ where: { rewardId: id, redemptionId: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      this.prisma.voucherCode.count({ where: { rewardId: id, redemptionId: { not: null } } }),
      this.prisma.voucherCode.count({ where: { rewardId: id, redemptionId: null, expiresAt: { lte: new Date() } } }),
    ]);
    return { free, used, expired };
  }

  @Post('rewards/:id/codes')
  @RequirePermission(Permission.WALLET_WRITE)
  async addCodes(@Param('id') id: string, @Body(new ZodPipe(voucherCodesSchema)) body: z.infer<typeof voucherCodesSchema>, @AdminActor() actor: AuditActor) {
    const r = await this.prisma.rewardItem.findUnique({ where: { id } });
    if (!r || r.kind !== 'VOUCHER') throw new BadRequestException('Codes can be added only to voucher rewards');
    const res = await this.prisma.voucherCode.createMany({
      data: body.codes.map((c) => ({ rewardId: id, code: c.code, pin: c.pin ?? null, expiresAt: c.expiresAt ? new Date(c.expiresAt) : null })),
      skipDuplicates: true,
    });
    // Never write codes themselves into the audit log.
    await this.audit.log(actor, { action: 'reward.codes_added', entityType: 'RewardItem', entityId: id, meta: { submitted: body.codes.length, added: res.count } });
    return { added: res.count, duplicates: body.codes.length - res.count };
  }

  @Delete('rewards/:id/codes/unused')
  @RequirePermission(Permission.WALLET_WRITE)
  async clearCodes(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    const res = await this.prisma.voucherCode.deleteMany({ where: { rewardId: id, redemptionId: null } });
    await this.audit.log(actor, { action: 'reward.codes_cleared', entityType: 'RewardItem', entityId: id, meta: { removed: res.count } });
    return { removed: res.count };
  }

  // ---------------- Redemptions

  @Get('redemptions')
  @RequirePermission(Permission.WALLET_READ)
  redemptions(@Query('status') status?: string, @Query('kind') kind?: string, @Query('userId') userId?: string) {
    return this.wallet.adminRedemptions({ status, kind, userId });
  }

  @Post('redemptions/:id/action')
  @HttpCode(200)
  @RequirePermission(Permission.WALLET_WRITE)
  act(@Param('id') id: string, @Body(new ZodPipe(redemptionActionSchema)) body: RedemptionActionInput, @AdminActor() actor: AuditActor) {
    return this.wallet.act(id, body, actor);
  }

  /** Approved merch redemptions as CSV for the shipping partner. */
  @Get('redemptions/shipping.csv')
  @RequirePermission(Permission.WALLET_WRITE)
  async shippingCsv() {
    const rows = await this.prisma.redemption.findMany({ where: { status: 'APPROVED', reward: { kind: 'MERCH' } }, include: { reward: true }, orderBy: { createdAt: 'asc' } });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['redemptionId', 'item', 'variant', 'name', 'phone', 'line1', 'line2', 'city', 'state', 'pincode'];
    const lines = rows.map((r) => {
      const a = (r.shippingAddress ?? {}) as Record<string, string>;
      return [r.id, r.reward.titleEn, r.variant, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode].map(esc).join(',');
    });
    return { filename: `shipping-${new Date().toISOString().slice(0, 10)}.csv`, csv: [header.join(','), ...lines].join('\n') };
  }

  // ---------------- User wallets

  @Get('users/:userId')
  @RequirePermission(Permission.WALLET_READ)
  user(@Param('userId') userId: string) {
    return this.wallet.userWallet(userId);
  }

  @Post('users/:userId/adjust')
  @HttpCode(200)
  @RequirePermission(Permission.WALLET_WRITE)
  adjust(@Param('userId') userId: string, @Body(new ZodPipe(walletAdjustSchema)) body: WalletAdjustInput, @AdminActor() actor: AuditActor) {
    return this.wallet.adjust(userId, body, actor);
  }

  @Post('users/:userId/freeze')
  @HttpCode(200)
  @RequirePermission(Permission.WALLET_WRITE)
  freeze(@Param('userId') userId: string, @Body(new ZodPipe(walletFreezeSchema)) body: z.infer<typeof walletFreezeSchema>, @AdminActor() actor: AuditActor) {
    return this.wallet.freeze(userId, body.frozen, body.reason, actor);
  }

  /** Recent coin movements across all users (audit view). */
  @Get('transactions')
  @RequirePermission(Permission.WALLET_READ)
  async transactions(@Query('type') type?: string) {
    const rows = await this.prisma.walletTxn.findMany({
      where: type ? { type: type as Prisma.EnumWalletTxnTypeFilter['equals'] } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
    return rows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
  }
}
