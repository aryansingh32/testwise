import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma, type AdminUser, type SeriesStatus, type TestStatus } from '@prisma/client';
import {
  assembleSchema,
  couponSchema,
  faqSchema,
  Permission,
  refundRequestSchema,
  resultActionSchema,
  rewardActionSchema,
  seriesSchema,
  testSchema,
  ticketReplySchema,
  type SeriesInput,
  type TestInput,
} from '@testwise/shared';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentAdmin, RequirePermission } from '../common/auth.guards';
import { parsePaging } from '../common/pagination';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../common/tokens.service';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { ResultsService } from '../results/results.service';
import { StoreService } from '../store/store.service';
import { TestsService } from '../tests/tests.service';

const statusSchema = z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']) });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const grantSchema = z.object({ email: z.string().email(), days: z.number().int().min(1).max(3650) });

const page = (p?: string, s?: string) => parsePaging(p, s, { defaultSize: 25 });

@Controller('v1/admin/tests')
@UseGuards(AdminAuthGuard)
export class AdminTestsController {
  constructor(private readonly tests: TestsService) {}

  @Get()
  @RequirePermission(Permission.CONTENT_READ)
  list(@Query('status') status?: TestStatus, @Query('q') q?: string, @Query('kind') kind?: string) {
    return this.tests.list({ status, q, kind });
  }

  @Post('assemble')
  @RequirePermission(Permission.CONTENT_WRITE)
  assemble(@Body(new ZodPipe(assembleSchema)) body: z.infer<typeof assembleSchema>) {
    return this.tests.assemble(body);
  }

  @Get(':id')
  @RequirePermission(Permission.CONTENT_READ)
  get(@Param('id') id: string) {
    return this.tests.get(id);
  }

  @Post()
  @RequirePermission(Permission.CONTENT_WRITE)
  create(@Body(new ZodPipe(testSchema)) body: TestInput, @AdminActor() actor: AuditActor) {
    return this.tests.create(body, actor);
  }

  @Put(':id')
  @RequirePermission(Permission.CONTENT_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(testSchema)) body: TestInput, @AdminActor() actor: AuditActor) {
    return this.tests.update(id, body, actor);
  }

  @Post(':id/status')
  @RequirePermission(Permission.CONTENT_REVIEW)
  status(@Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: { status: TestStatus }, @AdminActor() actor: AuditActor) {
    return this.tests.setStatus(id, body.status, actor);
  }

  @Post(':id/duplicate')
  @RequirePermission(Permission.CONTENT_WRITE)
  duplicate(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.tests.duplicate(id, actor);
  }

  @Delete(':id')
  @RequirePermission(Permission.CONTENT_WRITE)
  remove(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.tests.remove(id, actor);
  }
}

@Controller('v1/admin/store')
@UseGuards(AdminAuthGuard)
export class AdminStoreController {
  constructor(
    private readonly store: StoreService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('series')
  @RequirePermission(Permission.CONTENT_READ)
  list() {
    return this.store.adminList();
  }

  @Get('series/:id')
  @RequirePermission(Permission.CONTENT_READ)
  get(@Param('id') id: string) {
    return this.store.adminGet(id);
  }

  @Post('series')
  @RequirePermission(Permission.STORE_WRITE)
  create(@Body(new ZodPipe(seriesSchema)) body: SeriesInput, @AdminActor() actor: AuditActor) {
    return this.store.create(body, actor);
  }

  @Put('series/:id')
  @RequirePermission(Permission.STORE_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(seriesSchema)) body: SeriesInput, @AdminActor() actor: AuditActor) {
    return this.store.update(id, body, actor);
  }

  @Post('series/:id/status')
  @RequirePermission(Permission.STORE_WRITE)
  status(@Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: { status: SeriesStatus }, @AdminActor() actor: AuditActor) {
    return this.store.setStatus(id, body.status, actor);
  }

  @Post('series/:id/grant')
  @RequirePermission(Permission.STORE_WRITE)
  grant(@Param('id') id: string, @Body(new ZodPipe(grantSchema)) body: z.infer<typeof grantSchema>, @AdminActor() actor: AuditActor) {
    return this.store.grant(id, body.email, body.days, actor);
  }

  @Get('coupons')
  @RequirePermission(Permission.FINANCE_READ)
  coupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private couponData(b: z.infer<typeof couponSchema>) {
    return { ...b, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null, percentOff: b.percentOff ?? null, amountOffPaise: b.amountOffPaise ?? null };
  }

  @Post('coupons')
  @RequirePermission(Permission.STORE_WRITE)
  async createCoupon(@Body(new ZodPipe(couponSchema)) body: z.infer<typeof couponSchema>, @AdminActor() actor: AuditActor) {
    const c = await this.prisma.coupon.create({ data: this.couponData(body) }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Coupon code already exists');
      throw e;
    });
    await this.audit.log(actor, { action: 'coupon.create', entityType: 'Coupon', entityId: c.id, after: c });
    return c;
  }

  @Put('coupons/:id')
  @RequirePermission(Permission.STORE_WRITE)
  async updateCoupon(@Param('id') id: string, @Body(new ZodPipe(couponSchema)) body: z.infer<typeof couponSchema>, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.coupon.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const c = await this.prisma.coupon.update({ where: { id }, data: this.couponData(body) });
    await this.audit.log(actor, { action: 'coupon.update', entityType: 'Coupon', entityId: id, before, after: c });
    return c;
  }
}

@Controller('v1/admin/finance')
@UseGuards(AdminAuthGuard)
export class AdminFinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('summary')
  @RequirePermission(Permission.FINANCE_READ)
  async summary() {
    const [recon, pendingRefunds, providers] = await Promise.all([
      this.payments.reconciliation(),
      this.prisma.refund.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
      this.payments.providerStatus(),
    ]);
    return { ...recon, pendingRefunds, providers };
  }

  @Get('orders')
  @RequirePermission(Permission.FINANCE_READ)
  async orders(@Query('status') status?: string, @Query('q') q?: string, @Query('page') p?: string, @Query('pageSize') s?: string) {
    const pg = page(p, s);
    const where: Prisma.OrderWhereInput = {
      ...(status && { status: status as never }),
      ...(q && { OR: [{ receiptNo: { contains: q, mode: 'insensitive' } }, { user: { email: { contains: q, mode: 'insensitive' } } }, { providerPaymentId: q }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take, include: { user: { select: { displayName: true, email: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: pg.page, pageSize: pg.pageSize };
  }

  @Get('orders/:id')
  @RequirePermission(Permission.FINANCE_READ)
  async order(@Param('id') id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true, email: true } }, refunds: true, events: { orderBy: { receivedAt: 'asc' } } } });
    if (!o) throw new NotFoundException();
    const ledger = await this.prisma.ledgerEntry.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } });
    return { ...o, ledger };
  }

  @Post('orders/:id/refund')
  @RequirePermission(Permission.FINANCE_WRITE)
  refund(@Param('id') id: string, @Body(new ZodPipe(refundRequestSchema)) body: z.infer<typeof refundRequestSchema>, @AdminActor() actor: AuditActor) {
    return this.payments.requestRefund(id, body.amountPaise, body.reason, actor);
  }

  @Get('refunds')
  @RequirePermission(Permission.FINANCE_READ)
  refunds(@Query('status') status?: string) {
    return this.prisma.refund.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { order: { select: { receiptNo: true, amountPaise: true, descriptionEn: true, user: { select: { email: true } } } } },
    });
  }

  @Post('refunds/:id/approve')
  @RequirePermission(Permission.FINANCE_WRITE)
  approve(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.payments.approveRefund(id, actor);
  }

  @Post('refunds/:id/reject')
  @RequirePermission(Permission.FINANCE_WRITE)
  reject(@Param('id') id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @AdminActor() actor: AuditActor) {
    return this.payments.rejectRefund(id, body.reason, actor);
  }

  @Get('ledger')
  @RequirePermission(Permission.FINANCE_READ)
  async ledgerEntries(@Query('account') account?: string, @Query('page') p?: string) {
    const pg = page(p, '50');
    const where = account ? { account } : {};
    const [items, total, balances] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      this.prisma.ledgerEntry.count({ where }),
      this.ledger.balances(),
    ]);
    return { items, total, page: pg.page, pageSize: pg.pageSize, balances };
  }

  @Get('webhooks')
  @RequirePermission(Permission.FINANCE_READ)
  webhooks() {
    return this.prisma.paymentEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 100, select: { id: true, provider: true, eventId: true, type: true, orderId: true, signatureValid: true, processedAt: true, error: true, receivedAt: true } });
  }
}

@Controller('v1/admin/results')
@UseGuards(AdminAuthGuard)
export class AdminResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get(':tournamentId')
  @RequirePermission(Permission.TOURNAMENT_READ)
  get(@Param('tournamentId') id: string) {
    return this.results.forAdmin(id);
  }

  @Get(':tournamentId/attempts/:attemptId/proctor-events')
  @RequirePermission(Permission.TOURNAMENT_READ)
  proctorEvents(@Param('tournamentId') tournamentId: string, @Param('attemptId') attemptId: string) {
    return this.results.proctorEvents(tournamentId, attemptId);
  }

  @Post(':tournamentId/attempts/:attemptId/warn')
  @RequirePermission(Permission.RESULTS_WRITE)
  warn(@Param('tournamentId') tournamentId: string, @Param('attemptId') attemptId: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @AdminActor() actor: AuditActor) {
    return this.results.warnDuringAttempt(tournamentId, attemptId, body.reason, actor);
  }

  @Post(':tournamentId/generate')
  @RequirePermission(Permission.RESULTS_WRITE)
  generate(@Param('tournamentId') id: string, @AdminActor() actor: AuditActor) {
    return this.results.generate(id, actor, undefined, 'Regenerated by admin');
  }

  @Post(':tournamentId/action')
  @RequirePermission(Permission.RESULTS_WRITE)
  action(@Param('tournamentId') id: string, @Body(new ZodPipe(resultActionSchema)) body: z.infer<typeof resultActionSchema>, @AdminActor() actor: AuditActor) {
    return this.results.act(id, body, actor);
  }

  @Post(':tournamentId/finalize')
  @RequirePermission(Permission.RESULTS_WRITE)
  finalize(@Param('tournamentId') id: string, @AdminActor() actor: AuditActor) {
    return this.results.finalize(id, actor);
  }

  @Post(':tournamentId/reopen')
  @RequirePermission(Permission.RESULTS_WRITE)
  reopen(@Param('tournamentId') id: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @AdminActor() actor: AuditActor) {
    return this.results.reopen(id, body.reason, actor);
  }

  @Post(':tournamentId/rewards')
  @RequirePermission(Permission.FINANCE_WRITE)
  rewards(@Param('tournamentId') id: string, @Body(new ZodPipe(rewardActionSchema)) body: z.infer<typeof rewardActionSchema>, @AdminActor() actor: AuditActor) {
    return this.results.rewards(id, body, actor);
  }
}

@Controller('v1/admin/support')
@UseGuards(AdminAuthGuard)
export class AdminSupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokensService,
  ) {}

  @Get('tickets')
  @RequirePermission(Permission.SUPPORT_READ)
  async tickets(@Query('status') status?: string, @Query('category') category?: string, @Query('page') p?: string) {
    const pg = page(p, '30');
    const where: Prisma.SupportTicketWhereInput = { ...(status && { status: status as never }), ...(category && { category: category as never }) };
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: pg.skip, take: pg.take, include: { user: { select: { displayName: true, email: true } }, _count: { select: { messages: true } } } }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { items, total, page: pg.page, pageSize: pg.pageSize };
  }

  @Get('tickets/:id')
  @RequirePermission(Permission.SUPPORT_READ)
  async ticket(@Param('id') id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true, email: true } }, messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) throw new NotFoundException();
    return t;
  }

  @Post('tickets/:id/reply')
  @RequirePermission(Permission.SUPPORT_WRITE)
  async reply(@Param('id') id: string, @Body(new ZodPipe(ticketReplySchema)) body: z.infer<typeof ticketReplySchema>, @CurrentAdmin() admin: AdminUser, @AdminActor() actor: AuditActor) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t) throw new NotFoundException();
    await this.prisma.supportTicket.update({ where: { id }, data: { status: body.close ? 'CLOSED' : 'ANSWERED', messages: { create: { fromAdmin: true, authorId: admin.id, body: body.body } } } });
    await this.notifications.event('SUPPORT_REPLY', t.userId, { subject: t.subject }, { link: `/support/${t.id}` });
    await this.audit.log(actor, { action: 'ticket.reply', entityType: 'SupportTicket', entityId: id, meta: { close: !!body.close } });
    return this.ticket(id);
  }

  /** Anonymise an account after a deletion request. Blocked while money or rewards are outstanding. */
  @Post('users/:userId/delete')
  @RequirePermission(Permission.USERS_WRITE)
  async deleteUser(@Param('userId') userId: string, @Body(new ZodPipe(reasonSchema)) body: { reason: string }, @AdminActor() actor: AuditActor) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    const [pendingRefunds, pendingRewards] = await Promise.all([
      this.prisma.refund.count({ where: { order: { userId }, status: { in: ['REQUESTED', 'APPROVED'] } } }),
      this.prisma.resultEntry.count({ where: { userId, rewardStatus: { in: ['ELIGIBLE', 'APPROVED'] } } }),
    ]);
    if (pendingRefunds || pendingRewards) throw new ConflictException('Resolve pending refunds and rewards before deleting this account');
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: null, passwordHash: null, phone: null, firebaseUid: null, displayName: 'Deleted user', avatarUrl: null, dateOfBirth: null, status: 'SUSPENDED', deletedAt: new Date() },
    });
    await this.tokens.revokeAll('USER', userId);
    await this.prisma.supportTicket.updateMany({ where: { userId, category: 'DATA_DELETION', status: { not: 'CLOSED' } }, data: { status: 'CLOSED' } });
    // Financial records and results are retained (anonymised) as required for audit.
    await this.audit.log(actor, { action: 'user.deleted', entityType: 'User', entityId: userId, meta: { reason: body.reason } });
    return { ok: true };
  }

  // ----- FAQs
  @Get('faqs')
  @RequirePermission(Permission.SUPPORT_READ)
  faqs() {
    return this.prisma.faq.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
  }

  @Post('faqs')
  @RequirePermission(Permission.SUPPORT_WRITE)
  async createFaq(@Body(new ZodPipe(faqSchema)) body: z.infer<typeof faqSchema>, @AdminActor() actor: AuditActor) {
    const f = await this.prisma.faq.create({ data: body });
    await this.audit.log(actor, { action: 'faq.create', entityType: 'Faq', entityId: f.id, after: f });
    return f;
  }

  @Put('faqs/:id')
  @RequirePermission(Permission.SUPPORT_WRITE)
  async updateFaq(@Param('id') id: string, @Body(new ZodPipe(faqSchema)) body: z.infer<typeof faqSchema>, @AdminActor() actor: AuditActor) {
    const f = await this.prisma.faq.update({ where: { id }, data: body });
    await this.audit.log(actor, { action: 'faq.update', entityType: 'Faq', entityId: id, after: f });
    return f;
  }

  @Delete('faqs/:id')
  @RequirePermission(Permission.SUPPORT_WRITE)
  async deleteFaq(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    await this.prisma.faq.delete({ where: { id } });
    await this.audit.log(actor, { action: 'faq.delete', entityType: 'Faq', entityId: id });
    return { ok: true };
  }
}
