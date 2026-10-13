import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Order, type OrderKind } from '@prisma/client';
import { formatRupees, type CheckoutDto, type OrderDto } from '@testwise/shared';
import { createHash, randomBytes } from 'crypto';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditService, type AuditActor } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../common/prisma.service';
import { XpService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { whenVar } from '../notifications/vars';
import { Account, LedgerService } from './ledger.service';
import { MockProvider, PaytmProvider, RazorpayProvider, type PaymentProvider, type ProviderName, type WebhookOutcome } from './providers';

type Tx = Prisma.TransactionClient;

const orderInclude = { refunds: { orderBy: { createdAt: 'desc' } } } satisfies Prisma.OrderInclude;

export function toOrderDto(o: Prisma.OrderGetPayload<{ include: typeof orderInclude }>): OrderDto {
  return {
    id: o.id, receiptNo: o.receiptNo, kind: o.kind, descriptionEn: o.descriptionEn, amountPaise: o.amountPaise,
    discountPaise: o.discountPaise, couponCode: o.couponCode, status: o.status, provider: o.provider,
    providerPaymentId: o.providerPaymentId, paidAt: o.paidAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString(),
    refunds: o.refunds.map((r) => ({ id: r.id, amountPaise: r.amountPaise, status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString() })),
  };
}

function receiptNo() {
  const d = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  return `TW-${d}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: NodeJS.Timeout;
  readonly mock: MockProvider;
  private readonly providers: Record<ProviderName, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly xp: XpService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
  ) {
    const mockSecret = process.env.MOCK_WEBHOOK_SECRET ?? createHash('sha256').update(`mock:${process.env.JWT_ADMIN_SECRET ?? 'dev'}`).digest('hex');
    this.mock = new MockProvider(mockSecret);
    this.providers = { MOCK: this.mock, RAZORPAY: new RazorpayProvider(), PAYTM: new PaytmProvider() };
  }

  onModuleInit() {
    this.config.registerValidator('payments.gateway', (v) => {
      const name = (v as { provider: ProviderName }).provider;
      return this.providers[name]?.isConfigured() ? null : `${name} is not configured on the server (missing API keys or integration).`;
    });
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.redis.withLock('job:expire-orders', 60_000, () => this.expireOrders()).catch((e) => this.logger.error(e)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  provider(name: string): PaymentProvider {
    const p = this.providers[name as ProviderName];
    if (!p) throw new NotFoundException('Unknown payment provider');
    return p;
  }

  providerStatus() {
    return (Object.keys(this.providers) as ProviderName[]).map((n) => ({ name: n, configured: this.providers[n].isConfigured() }));
  }

  private async activeProvider() {
    const gw = await this.config.get('payments.gateway');
    const p = this.providers[gw.provider];
    if (!p.isConfigured()) throw new ServiceUnavailableException(`Payments are unavailable: ${gw.provider} is not configured`);
    return p;
  }

  // ------------------------------------------------------------- Coupons

  async quoteCoupon(code: string | null | undefined, kind: OrderKind, amountPaise: number) {
    if (!code) return { discountPaise: 0, coupon: null };
    if (kind === 'COIN_TOPUP') throw new BadRequestException('Coupons cannot be used for coin top-ups');
    const c = await this.prisma.coupon.findUnique({ where: { code } });
    const now = new Date();
    if (!c || !c.active || (c.startsAt && c.startsAt > now) || (c.endsAt && c.endsAt < now)) throw new BadRequestException('This coupon is not valid');
    if (c.maxUses != null && c.usedCount >= c.maxUses) throw new BadRequestException('This coupon has been fully used');
    if ((c.appliesTo === 'SERIES' && kind !== 'SERIES_PURCHASE') || (c.appliesTo === 'TOURNAMENT' && kind !== 'TOURNAMENT_ENTRY')) {
      throw new BadRequestException('This coupon does not apply here');
    }
    const discount = c.percentOff ? Math.round((amountPaise * c.percentOff) / 100) : Math.min(amountPaise, c.amountOffPaise ?? 0);
    return { discountPaise: Math.min(discount, amountPaise), coupon: c };
  }

  // ------------------------------------------------------------- Orders

  /**
   * Create (or return the existing) order for an idempotency key. Zero-amount orders
   * (e.g. 100% coupon) are marked paid immediately and fulfilled in the caller's transaction.
   */
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Concurrent requests with the same idempotency key on this replica share ONE in-flight run. Each would otherwise hold a
   * pooled connection while blocked on the per-key advisory lock below; a client firing many parallel retries could then
   * starve the pool. Across replicas the advisory lock still serialises, so the loser reads the winner's order.
   */
  singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = run().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async createOrder(
    input: { userId: string; kind: OrderKind; refId: string; descriptionEn: string; amountPaise: number; couponCode?: string | null; idempotencyKey: string },
    tx: Tx,
  ): Promise<Order> {
    // Serialize concurrent requests carrying the same key (a client retry racing its original). Without this both pass the
    // check below, both call the payment provider (an orphaned payment link), and the loser fails on the unique key.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
    const existing = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.userId !== input.userId || existing.refId !== input.refId) throw new ConflictException('Idempotency key reused for a different purchase');
      return existing;
    }
    const { discountPaise, coupon } = await this.quoteCoupon(input.couponCode, input.kind, input.amountPaise);
    const payable = input.amountPaise - discountPaise;
    const { orderExpiryMinutes } = await this.config.get('payments.policy');
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    const rno = receiptNo();
    let provider = 'NONE';
    let providerOrderId: string | null = null;
    let checkoutUrl: string | null = null;
    if (payable > 0) {
      const p = await this.activeProvider();
      provider = p.name;
      const created = await p.createOrder({ receiptNo: rno, amountPaise: payable, description: input.descriptionEn, customer: { name: user.displayName, email: user.email } });
      providerOrderId = created.providerOrderId;
      checkoutUrl = created.checkoutUrl;
    }
    if (coupon) await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    return tx.order.create({
      data: {
        receiptNo: rno, userId: input.userId, kind: input.kind, refId: input.refId, descriptionEn: input.descriptionEn,
        amountPaise: payable, discountPaise, couponCode: coupon?.code ?? null, provider, providerOrderId, checkoutUrl, idempotencyKey: input.idempotencyKey,
        status: payable > 0 ? 'CREATED' : 'PAID', paidAt: payable > 0 ? null : new Date(),
        expiresAt: new Date(Date.now() + orderExpiryMinutes * 60_000),
      },
    });
  }

  async checkout(order: Order): Promise<CheckoutDto> {
    const full = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    return {
      order: toOrderDto(full),
      provider: (full.provider === 'NONE' ? 'MOCK' : full.provider) as CheckoutDto['provider'],
      providerOrderId: full.providerOrderId,
      checkoutUrl: full.status === 'CREATED' ? full.checkoutUrl : null,
      amountPaise: full.amountPaise,
      completed: full.status === 'PAID',
    };
  }

  async myOrders(userId: string) {
    const rows = await this.prisma.order.findMany({ where: { userId }, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(toOrderDto);
  }

  async myOrder(userId: string, id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!o || o.userId !== userId) throw new NotFoundException('Order not found');
    return toOrderDto(o);
  }

  // ------------------------------------------------------------- Webhooks

  async handleWebhook(providerName: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const provider = this.provider(providerName.toUpperCase());
    const signatureValid = provider.verifySignature(rawBody, headers);
    // Never persist unsigned requests: a forged event id would otherwise shadow the genuine event (unique provider+eventId) and drop real payments.
    if (!signatureValid) {
      this.logger.warn(`Rejected ${providerName} webhook with invalid signature`);
      throw new ForbiddenException('Invalid signature');
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON');
    }
    const eventHeader = typeof headers['x-razorpay-event-id'] === 'string' ? (headers['x-razorpay-event-id'] as string) : undefined;
    let outcome: WebhookOutcome;
    try {
      outcome = (provider as PaymentProvider & { parseWebhook(b: unknown, e?: string): WebhookOutcome }).parseWebhook(body, eventHeader);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    if (typeof outcome.eventId !== 'string' || !outcome.eventId || outcome.eventId.length > 200) {
      throw new BadRequestException('Missing or invalid event id');
    }

    let event;
    try {
      event = await this.prisma.paymentEvent.create({
        data: { provider: provider.name, eventId: outcome.eventId, type: outcome.type, signatureValid, payload: body as Prisma.InputJsonValue },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
      throw e;
    }
    try {
      const orderId = await this.applyOutcome(provider.name, outcome);
      await this.prisma.paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), orderId } });
      return { ok: true };
    } catch (e) {
      await this.prisma.paymentEvent.update({ where: { id: event.id }, data: { error: (e as Error).message.slice(0, 500) } });
      this.logger.error(`Webhook ${event.id} failed: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  private async applyOutcome(provider: string, o: WebhookOutcome): Promise<string | null> {
    if (o.type === 'IGNORED') return null;
    if (o.type === 'REFUND_PROCESSED') {
      const order = o.providerPaymentId ? await this.prisma.order.findFirst({ where: { providerPaymentId: o.providerPaymentId } }) : null;
      return order?.id ?? null;
    }
    const order = o.providerOrderId ? await this.prisma.order.findUnique({ where: { providerOrderId: o.providerOrderId } }) : null;
    if (!order || order.provider !== provider) throw new Error('Order not found for webhook');

    if (o.type === 'PAYMENT_FAILED') {
      const res = await this.prisma.order.updateMany({ where: { id: order.id, status: 'CREATED' }, data: { status: 'FAILED', failureReason: o.failureReason ?? 'Payment failed' } });
      if (res.count) await this.notifications.event('PAYMENT_FAILED', order.userId, { amount: formatRupees(order.amountPaise), item: order.descriptionEn }, { link: `/orders/${order.id}` });
      return order.id;
    }

    // PAYMENT_CAPTURED
    if (o.amountPaise != null && o.amountPaise !== order.amountPaise) throw new Error(`Amount mismatch: got ${o.amountPaise}, expected ${order.amountPaise}`);
    if (order.status === 'PAID' || order.status === 'REFUNDED' || order.status === 'REFUND_PENDING') return order.id;
    const late = order.status === 'CANCELLED' || order.status === 'FAILED';
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: order.id, status: { in: ['CREATED', 'CANCELLED', 'FAILED'] } },
        data: { status: 'PAID', paidAt: new Date(), providerPaymentId: o.providerPaymentId },
      });
      if (!res.count) return;
      await this.postCapture(order, tx);
      await this.notifications.event('PAYMENT_SUCCESS', order.userId, { amount: formatRupees(order.amountPaise), item: order.descriptionEn, receipt: order.receiptNo }, { link: `/orders/${order.id}`, tx });
      if (!late) await this.fulfill(order.id, tx);
    });
    // Money arrived after the order expired: the seat may be gone, so refund in full.
    if (late) await this.requestRefund(order.id, order.amountPaise, 'Payment received after checkout expired', { type: 'SYSTEM' }, true);
    return order.id;
  }

  /** Development only: simulate the gateway sending a signed webhook for this order. */
  async mockPay(orderId: string, userId: string, outcome: 'success' | 'failure') {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (order.provider !== 'MOCK') throw new BadRequestException('This order does not use the mock gateway');
    if (order.status !== 'CREATED') throw new ConflictException(`Order is ${order.status.toLowerCase()}`);
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
      orderId: order.providerOrderId,
      paymentId: `mock_pay_${randomBytes(6).toString('hex')}`,
      amountPaise: order.amountPaise,
      reason: outcome === 'failure' ? 'Payment declined (simulated)' : undefined,
    });
    await this.handleWebhook('MOCK', Buffer.from(body), { 'x-mock-signature': this.mock.sign(body) });
    return this.myOrder(userId, orderId);
  }

  // ------------------------------------------------------------- Fulfilment & ledger

  private async postCapture(order: Order, tx: Tx) {
    const { gatewayFeePercent } = await this.config.get('payments.policy');
    const fee = Math.round((order.amountPaise * gatewayFeePercent) / 100);
    let prize = 0;
    let tournamentId: string | null = null;
    if (order.kind === 'TOURNAMENT_ENTRY') {
      const reg = await tx.registration.findUnique({ where: { id: order.refId }, include: { tournament: true } });
      if (reg) {
        tournamentId = reg.tournamentId;
        if (reg.tournament.fundingSource === 'ENTRY_FEES') prize = order.amountPaise - Math.round((order.amountPaise * reg.tournament.platformFeePercent) / 100);
      }
    }
    await this.ledger.post(
      [
        { account: Account.GATEWAY_RECEIVABLE, debit: order.amountPaise },
        { account: Account.PRIZE_POOL_LIABILITY, credit: prize },
        // Top-ups are not revenue until the coins are spent on a reward.
        { account: order.kind === 'COIN_TOPUP' ? Account.COIN_LIABILITY_PURCHASED : Account.PLATFORM_REVENUE, credit: order.amountPaise - prize },
      ],
      { memo: `capture ${order.receiptNo}`, orderId: order.id, tournamentId },
      tx,
    );
    await this.ledger.post(
      [
        { account: Account.GATEWAY_FEES, debit: fee },
        { account: Account.GATEWAY_RECEIVABLE, credit: fee },
      ],
      { memo: `gateway fee ${order.receiptNo}`, orderId: order.id, tournamentId },
      tx,
    );
  }

  /** Deliver what was bought. Called inside the payment transaction. */
  async fulfill(orderId: string, tx: Tx) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.kind === 'COIN_TOPUP') {
      await this.wallet.fulfilTopUp(tx, order);
      return;
    }
    if (order.kind === 'TOURNAMENT_ENTRY') {
      const reg = await tx.registration.findUnique({ where: { id: order.refId }, include: { tournament: true } });
      if (!reg) return;
      const confirmed = await tx.registration.count({ where: { tournamentId: reg.tournamentId, status: 'CONFIRMED' } });
      if (confirmed >= reg.tournament.maxParticipants || !['REG_OPEN', 'REG_CLOSED', 'SCHEDULED'].includes(reg.tournament.status)) {
        await tx.registration.update({ where: { id: reg.id }, data: { status: 'CANCELLED', cancelReason: 'Seats filled before payment completed' } });
        // Refund after the transaction commits.
        setImmediate(() => void this.requestRefund(order.id, order.amountPaise, 'Tournament full or closed when payment completed', { type: 'SYSTEM' }, true).catch((e) => this.logger.error(e)));
        return;
      }
      await tx.registration.update({ where: { id: reg.id }, data: { status: 'CONFIRMED' } });
      const xp = await this.config.get('gamification.xp');
      await this.xp.award(reg.userId, xp.perTournamentJoined, 'tournament', reg.tournamentId, tx);
      await this.notifications.event('TOURNAMENT_REGISTERED', reg.userId, { tournament: { en: reg.tournament.titleEn, hi: reg.tournament.titleHi }, startsAt: whenVar(reg.tournament.startsAt) }, { link: `/tournament/${reg.tournament.slug}`, tx });
    } else {
      const series = await tx.testSeries.findUniqueOrThrow({ where: { id: order.refId } });
      const existing = await tx.enrollment.findUnique({ where: { userId_seriesId: { userId: order.userId, seriesId: series.id } } });
      const base = existing && existing.expiresAt > new Date() && !existing.revokedAt ? existing.expiresAt : new Date();
      const expiresAt = new Date(base.getTime() + series.validityDays * 86_400_000);
      await tx.enrollment.upsert({
        where: { userId_seriesId: { userId: order.userId, seriesId: series.id } },
        create: { userId: order.userId, seriesId: series.id, source: 'PURCHASE', orderId: order.id, expiresAt },
        update: { source: 'PURCHASE', orderId: order.id, expiresAt, revokedAt: null },
      });
      await this.notifications.event('SERIES_UNLOCKED', order.userId, { series: { en: series.titleEn, hi: series.titleHi } }, { link: `/series/${series.slug}`, tx });
    }
  }

  // ------------------------------------------------------------- Refunds

  /**
   * Request a refund. System refunds (cancellations, late payments) are approved automatically.
   * Admin refunds above the configured threshold need a second, different approver.
   */
  async requestRefund(orderId: string, amountPaise: number | undefined, reason: string, actor: AuditActor, autoApprove = false) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { refunds: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (!['PAID', 'REFUND_PENDING'].includes(order.status)) throw new ConflictException(`Order is ${order.status.toLowerCase()}`);
    const refunded = order.refunds.filter((r) => ['REQUESTED', 'APPROVED', 'PROCESSED'].includes(r.status)).reduce((s, r) => s + r.amountPaise, 0);
    const amount = amountPaise ?? order.amountPaise - refunded;
    if (amount <= 0 || amount + refunded > order.amountPaise) throw new BadRequestException('Refund exceeds the amount paid');
    if (order.kind === 'COIN_TOPUP') {
      if (amount !== order.amountPaise || refunded > 0) throw new BadRequestException('Coin top-ups can only be refunded in full');
      await this.wallet.assertTopUpRefundable(order);
    }
    const refund = await this.prisma.refund.create({
      data: { orderId, amountPaise: amount, reason, requestedBy: actor.type === 'SYSTEM' ? 'SYSTEM' : actor.id ?? 'unknown' },
    });
    await this.prisma.order.update({ where: { id: orderId }, data: { status: 'REFUND_PENDING' } });
    await this.audit.log(actor, { action: 'refund.request', entityType: 'Refund', entityId: refund.id, meta: { orderId, amount, reason } });
    if (autoApprove) return this.processRefund(refund.id, actor);
    await this.notifications.event('REFUND_INITIATED', order.userId, { amount: formatRupees(amount), receipt: order.receiptNo }, { link: `/orders/${order.id}` });
    return refund;
  }

  async approveRefund(refundId: string, actor: AuditActor) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!r) throw new NotFoundException('Refund not found');
    if (!['REQUESTED', 'APPROVED'].includes(r.status)) throw new ConflictException(`Refund is ${r.status.toLowerCase()}`);
    if (r.requestedBy === actor.id) throw new ForbiddenException('The requester cannot approve their own refund');
    const { refundDualApprovalAbovePaise } = await this.config.get('payments.policy');
    const needsTwo = r.amountPaise > refundDualApprovalAbovePaise;
    if (r.status === 'REQUESTED') {
      await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'APPROVED', approvedById: actor.id } });
      await this.audit.log(actor, { action: 'refund.approve', entityType: 'Refund', entityId: r.id, meta: { needsSecondApproval: needsTwo } });
      if (needsTwo) return this.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    } else {
      if (!needsTwo) throw new ConflictException('Already approved');
      if (r.approvedById === actor.id) throw new ForbiddenException('A different admin must give the second approval');
      await this.prisma.refund.update({ where: { id: r.id }, data: { secondApproverId: actor.id } });
      await this.audit.log(actor, { action: 'refund.second_approval', entityType: 'Refund', entityId: r.id });
    }
    return this.processRefund(r.id, actor);
  }

  async rejectRefund(refundId: string, reason: string, actor: AuditActor) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { order: { include: { refunds: true } } } });
    if (!r) throw new NotFoundException('Refund not found');
    if (!['REQUESTED', 'APPROVED'].includes(r.status)) throw new ConflictException(`Refund is ${r.status.toLowerCase()}`);
    await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'REJECTED' } });
    const stillPending = r.order.refunds.some((x) => x.id !== r.id && ['REQUESTED', 'APPROVED'].includes(x.status));
    if (!stillPending && r.order.status === 'REFUND_PENDING') {
      const processed = r.order.refunds.filter((x) => x.status === 'PROCESSED').reduce((s, x) => s + x.amountPaise, 0);
      await this.prisma.order.update({ where: { id: r.orderId }, data: { status: processed >= r.order.amountPaise ? 'REFUNDED' : 'PAID' } });
    }
    await this.audit.log(actor, { action: 'refund.reject', entityType: 'Refund', entityId: r.id, meta: { reason } });
    return { ok: true };
  }

  private async processRefund(refundId: string, actor: AuditActor) {
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { order: { include: { refunds: true } } } });
    const order = r.order;
    if (r.status === 'PROCESSED') return r;
    let providerRefundId: string;
    try {
      if (order.provider === 'NONE') providerRefundId = 'no-payment';
      else providerRefundId = (await this.provider(order.provider).refund({ providerPaymentId: order.providerPaymentId!, amountPaise: r.amountPaise, receiptNo: order.receiptNo })).providerRefundId;
    } catch (e) {
      await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED' } });
      await this.audit.log(actor, { action: 'refund.failed', entityType: 'Refund', entityId: r.id, meta: { error: (e as Error).message } });
      throw new ServiceUnavailableException(`Refund failed: ${(e as Error).message}`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: r.id }, data: { status: 'PROCESSED', providerRefundId, processedAt: new Date(), approvedById: r.approvedById ?? (actor.type === 'SYSTEM' ? 'SYSTEM' : actor.id) } });
      const processed = order.refunds.filter((x) => x.status === 'PROCESSED' && x.id !== r.id).reduce((s, x) => s + x.amountPaise, 0) + r.amountPaise;
      const full = processed >= order.amountPaise;
      const pending = order.refunds.some((x) => x.id !== r.id && ['REQUESTED', 'APPROVED'].includes(x.status));
      await tx.order.update({ where: { id: order.id }, data: { status: full ? 'REFUNDED' : pending ? 'REFUND_PENDING' : 'PAID' } });

      // Reverse the capture split proportionally.
      const capture = await tx.ledgerEntry.findMany({ where: { orderId: order.id, memo: { startsWith: 'capture' } } });
      const prizeCredit = capture.filter((c) => c.account === Account.PRIZE_POOL_LIABILITY).reduce((s, c) => s + c.creditPaise, 0);
      const prizePart = order.amountPaise ? Math.round((r.amountPaise * prizeCredit) / order.amountPaise) : 0;
      if (order.kind === 'COIN_TOPUP') await this.wallet.reverseTopUp(tx, order);
      await this.ledger.post(
        [
          { account: Account.PRIZE_POOL_LIABILITY, debit: prizePart },
          { account: order.kind === 'COIN_TOPUP' ? Account.COIN_LIABILITY_PURCHASED : Account.PLATFORM_REVENUE, debit: r.amountPaise - prizePart },
          { account: Account.GATEWAY_RECEIVABLE, credit: r.amountPaise },
        ],
        { memo: `refund ${order.receiptNo}`, orderId: order.id, tournamentId: capture[0]?.tournamentId ?? null },
        tx,
      );

      if (full) {
        if (order.kind === 'TOURNAMENT_ENTRY') {
          await tx.registration.updateMany({ where: { id: order.refId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', cancelReason: r.reason } });
        } else if (order.kind === 'SERIES_PURCHASE') {
          await tx.enrollment.updateMany({ where: { orderId: order.id }, data: { revokedAt: new Date() } });
        }
      }
      await this.notifications.event('REFUND_PROCESSED', order.userId, { amount: formatRupees(r.amountPaise), receipt: order.receiptNo, reason: r.reason }, { link: `/orders/${order.id}`, tx });
      await this.audit.log(actor, { action: 'refund.processed', entityType: 'Refund', entityId: r.id, meta: { providerRefundId, amount: r.amountPaise } }, tx);
      return tx.refund.findUniqueOrThrow({ where: { id: r.id } });
    });
  }

  // ------------------------------------------------------------- Housekeeping

  async expireOrders() {
    const due = await this.prisma.order.findMany({ where: { status: 'CREATED', expiresAt: { lt: new Date() } }, select: { id: true, kind: true, refId: true, userId: true, descriptionEn: true } });
    for (const o of due) {
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.order.updateMany({ where: { id: o.id, status: 'CREATED' }, data: { status: 'CANCELLED', failureReason: 'Checkout expired' } });
        if (res.count) await this.notifications.event('CHECKOUT_EXPIRED', o.userId, { item: o.descriptionEn }, { link: `/orders/${o.id}`, tx });
        if (res.count && o.kind === 'TOURNAMENT_ENTRY') {
          await tx.registration.updateMany({ where: { id: o.refId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED', cancelReason: 'Checkout expired' } });
        }
      });
    }
    return due.length;
  }

  /** Gateway-captured totals vs ledger, for the reconciliation view. */
  async reconciliation() {
    const [paid, refunds, events, balances] = await Promise.all([
      this.prisma.order.aggregate({ where: { status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED'] } }, _sum: { amountPaise: true }, _count: true }),
      this.prisma.refund.aggregate({ where: { status: 'PROCESSED' }, _sum: { amountPaise: true }, _count: true }),
      this.prisma.paymentEvent.groupBy({ by: ['provider', 'type'], _count: true, where: { error: null } }),
      this.ledger.balances(),
    ]);
    const receivable = balances.find((b) => b.account === Account.GATEWAY_RECEIVABLE);
    const fees = balances.find((b) => b.account === Account.GATEWAY_FEES);
    const expected = (paid._sum.amountPaise ?? 0) - (refunds._sum.amountPaise ?? 0) - ((fees?.debitPaise ?? 0) - (fees?.creditPaise ?? 0));
    const ledgerReceivable = (receivable?.debitPaise ?? 0) - (receivable?.creditPaise ?? 0);
    const failedEvents = await this.prisma.paymentEvent.count({ where: { error: { not: null } } });
    return {
      ordersPaid: paid._count,
      capturedPaise: paid._sum.amountPaise ?? 0,
      refundsProcessed: refunds._count,
      refundedPaise: refunds._sum.amountPaise ?? 0,
      expectedReceivablePaise: expected,
      ledgerReceivablePaise: ledgerReceivable,
      matched: expected === ledgerReceivable,
      failedWebhookEvents: failedEvents,
      events,
      balances,
    };
  }
}
