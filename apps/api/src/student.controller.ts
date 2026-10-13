import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import {
  attemptEventSchema,
  checkoutSchema,
  saveAnswersSchema,
  ticketCreateSchema,
  ticketReplySchema,
  type FaqDto,
  type SaveAnswersInput,
  type TicketDto,
} from '@testwise/shared';
import { z } from 'zod';
import { AppConfigService } from './app-config/app-config.service';
import { AttemptsService } from './attempts/attempts.service';
import { CurrentUser, UserAuthGuard } from './common/auth.guards';
import { AuditService } from './common/audit.service';
import { PrismaService } from './common/prisma.service';
import { ZodPipe } from './common/zod.pipe';
import { MissionsService } from './engagement/engagement.services';
import { GameCoinsService } from './engagement/game-coins.service';
import { NotificationsService } from './notifications/notifications.service';
import { PaymentsService } from './payments/payments.service';
import { ResultsService } from './results/results.service';
import { StoreService } from './store/store.service';
import { RegistrationsService } from './tournaments/registrations.service';

const startAttemptSchema = z.object({ proctorToken: z.string().max(4000).optional().nullable() }).default({});
const mockPaySchema = z.object({ outcome: z.enum(['success', 'failure']) });

@Controller('v1')
@UseGuards(UserAuthGuard)
export class StudentController {
  constructor(
    private readonly store: StoreService,
    private readonly attempts: AttemptsService,
    private readonly registrations: RegistrationsService,
    private readonly results: ResultsService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly missions: MissionsService,
    private readonly gameCoins: GameCoinsService,
  ) {}

  // ----- Store
  @Get('store/series')
  series(@CurrentUser() u: User, @Query('examId') examId?: string, @Query('q') q?: string) {
    return this.store.list(u.id, examId, q);
  }

  @Get('store/series/:slug')
  seriesDetail(@CurrentUser() u: User, @Param('slug') slug: string) {
    return this.store.detail(u.id, slug);
  }

  @Get('store/series/:slug/quote')
  quote(@Param('slug') slug: string, @Query('coupon') coupon: string) {
    return this.store.quote(slug, (coupon ?? '').toUpperCase());
  }

  @Post('store/series/:slug/purchase')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  purchase(@CurrentUser() u: User, @Param('slug') slug: string, @Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    return this.store.purchase(u.id, slug, body);
  }

  @Get('me/series')
  mySeries(@CurrentUser() u: User) {
    return this.store.mine(u.id);
  }

  // ----- Practice attempts
  @Post('tests/:id/attempts')
  startPractice(@CurrentUser() u: User, @Param('id') id: string, @Body(new ZodPipe(startAttemptSchema)) body: z.infer<typeof startAttemptSchema>) {
    return this.attempts.startPractice(u.id, id, body.proctorToken);
  }

  @Get('attempts/:id')
  paper(@CurrentUser() u: User, @Param('id') id: string) {
    return this.attempts.paperDto(id, u.id);
  }

  @Put('attempts/:id/answers')
  save(@CurrentUser() u: User, @Param('id') id: string, @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput) {
    return this.attempts.saveAnswers(id, u.id, body);
  }

  @Post('attempts/:id/events')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  event(@CurrentUser() u: User, @Param('id') id: string, @Body(new ZodPipe(attemptEventSchema)) body: z.infer<typeof attemptEventSchema>) {
    return this.attempts.logEvent(id, u.id, body);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  async submit(@CurrentUser() u: User, @Param('id') id: string, @Body(new ZodPipe(saveAnswersSchema.partial())) body: Partial<SaveAnswersInput>) {
    if (body.answers?.length) {
      try {
        await this.attempts.saveAnswers(id, u.id, { answers: body.answers, language: body.language });
      } catch {
        /* time up or already submitted: submit with what the server has */
      }
    }
    await this.attempts.submit(id, u.id, false);
    return this.attempts.result(id, u.id);
  }

  @Get('attempts/:id/result')
  result(@CurrentUser() u: User, @Param('id') id: string) {
    return this.attempts.result(id, u.id);
  }

  @Get('me/attempts')
  history(@CurrentUser() u: User) {
    return this.attempts.history(u.id);
  }

  @Get('me/analytics')
  analytics(@CurrentUser() u: User) {
    return this.attempts.analytics(u.id);
  }

  @Get('me/mistakes')
  mistakes(@CurrentUser() u: User) {
    return this.attempts.mistakes(u.id);
  }

  // ----- Tournaments
  @Get('tournaments/:slug/me')
  myState(@CurrentUser() u: User, @Param('slug') slug: string) {
    return this.registrations.state(u.id, slug);
  }

  @Post('tournaments/:slug/register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  register(@CurrentUser() u: User, @Param('slug') slug: string, @Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    return this.registrations.register(u.id, slug, body);
  }

  @Post('tournaments/:slug/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: User, @Param('slug') slug: string) {
    return this.registrations.cancel(u.id, slug);
  }

  @Post('tournaments/:slug/attempt')
  @HttpCode(200)
  startTournament(@CurrentUser() u: User, @Param('slug') slug: string, @Body(new ZodPipe(startAttemptSchema)) body: z.infer<typeof startAttemptSchema>) {
    return this.attempts.startTournament(u.id, slug, body.proctorToken);
  }

  @Get('tournaments/:slug/results')
  results_(@CurrentUser() u: User, @Param('slug') slug: string) {
    return this.results.forStudent(slug, u.id);
  }

  @Get('me/tournaments')
  myTournaments(@CurrentUser() u: User) {
    return this.registrations.mine(u.id);
  }

  // ----- Orders
  @Get('me/orders')
  orders(@CurrentUser() u: User) {
    return this.payments.myOrders(u.id);
  }

  @Get('me/orders/:id')
  order(@CurrentUser() u: User, @Param('id') id: string) {
    return this.payments.myOrder(u.id, id);
  }

  /** Simulated checkout for the MOCK gateway. Disabled once a real gateway is active. */
  @Post('payments/mock/:orderId/pay')
  @HttpCode(200)
  mockPay(@CurrentUser() u: User, @Param('orderId') orderId: string, @Body(new ZodPipe(mockPaySchema)) body: z.infer<typeof mockPaySchema>) {
    return this.payments.mockPay(orderId, u.id, body.outcome);
  }

  // ----- Engagement
  @Get('me/notifications')
  inbox(@CurrentUser() u: User) {
    return this.notifications.inbox(u.id);
  }

  @Post('me/notifications/read')
  @HttpCode(200)
  readAll(@CurrentUser() u: User) {
    return this.notifications.markAllRead(u.id);
  }

  @Get('me/missions')
  myMissions(@CurrentUser() u: User) {
    return this.missions.forUser(u.id);
  }

  /** Daily check-in, streak and level progress. Amounts are computed on the server. */
  @Get('me/coin-rewards')
  coinRewards(@CurrentUser() u: User) {
    return this.gameCoins.rewards(u.id);
  }

  @Post('me/coin-rewards/daily/claim')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  claimDaily(@CurrentUser() u: User) {
    return this.gameCoins.claimDaily(u.id);
  }
}

@Controller('v1')
export class SupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('support/faqs')
  async faqs(): Promise<FaqDto[]> {
    return this.prisma.faq.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, category: true, questionEn: true, questionHi: true, answerEn: true, answerHi: true },
    });
  }

  private toTicket(t: { id: string; category: string; subject: string; status: TicketDto['status']; createdAt: Date; updatedAt: Date; messages: { id: string; fromAdmin: boolean; body: string; createdAt: Date }[] }): TicketDto {
    return {
      id: t.id, category: t.category, subject: t.subject, status: t.status, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      messages: t.messages.map((m) => ({ id: m.id, fromAdmin: m.fromAdmin, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  }

  @Get('me/tickets')
  @UseGuards(UserAuthGuard)
  async tickets(@CurrentUser() u: User) {
    const rows = await this.prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { updatedAt: 'desc' }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    return rows.map((r) => this.toTicket(r));
  }

  @Get('me/tickets/:id')
  @UseGuards(UserAuthGuard)
  async ticket(@CurrentUser() u: User, @Param('id') id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t || t.userId !== u.id) throw new NotFoundException('Ticket not found');
    return this.toTicket(t);
  }

  @Post('me/tickets')
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@CurrentUser() u: User, @Body(new ZodPipe(ticketCreateSchema)) body: z.infer<typeof ticketCreateSchema>) {
    const { ticketsEnabled } = await this.config.get('support.contact');
    if (!ticketsEnabled) throw new ForbiddenException('Support tickets are currently disabled');
    const t = await this.prisma.supportTicket.create({
      data: {
        userId: u.id, category: body.category, subject: body.subject, tournamentId: body.tournamentId ?? null, orderId: body.orderId ?? null,
        messages: { create: { fromAdmin: false, authorId: u.id, body: body.message } },
      },
      include: { messages: true },
    });
    await this.audit.log({ type: 'USER', id: u.id }, { action: 'ticket.create', entityType: 'SupportTicket', entityId: t.id, meta: { category: body.category } });
    return this.toTicket(t);
  }

  @Post('me/tickets/:id/reply')
  @UseGuards(UserAuthGuard)
  async reply(@CurrentUser() u: User, @Param('id') id: string, @Body(new ZodPipe(ticketReplySchema)) body: z.infer<typeof ticketReplySchema>) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!t || t.userId !== u.id) throw new NotFoundException('Ticket not found');
    await this.prisma.supportTicket.update({
      where: { id },
      data: { status: body.close ? 'CLOSED' : 'OPEN', messages: { create: { fromAdmin: false, authorId: u.id, body: body.body } } },
    });
    return this.ticket(u, id);
  }

  /** Personal data export (DPDP/GDPR-style access request). */
  @Get('me/export')
  @UseGuards(UserAuthGuard)
  async export(@CurrentUser() u: User) {
    const [user, registrations, attempts, orders, tickets, xp] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { exams: { include: { exam: { select: { nameEn: true } } } } } }),
      this.prisma.registration.findMany({ where: { userId: u.id }, include: { tournament: { select: { titleEn: true } } } }),
      this.prisma.attempt.findMany({ where: { userId: u.id }, select: { id: true, testId: true, tournamentId: true, status: true, startedAt: true, submittedAt: true, score: true, maxScore: true, accuracy: true } }),
      this.prisma.order.findMany({ where: { userId: u.id }, include: { refunds: true } }),
      this.prisma.supportTicket.findMany({ where: { userId: u.id }, include: { messages: true } }),
      this.prisma.xpEvent.findMany({ where: { userId: u.id } }),
    ]);
    const { passwordHash: _p, ...profile } = user;
    await this.audit.log({ type: 'USER', id: u.id }, { action: 'user.data_export', entityType: 'User', entityId: u.id });
    return { exportedAt: new Date().toISOString(), profile, registrations, attempts, orders, tickets, xp };
  }

  @Post('me/delete-request')
  @UseGuards(UserAuthGuard)
  async deleteRequest(@CurrentUser() u: User, @Body() body: { reason?: string }) {
    const open = await this.prisma.supportTicket.findFirst({ where: { userId: u.id, category: 'DATA_DELETION', status: { not: 'CLOSED' } } });
    if (open) return { ticketId: open.id, alreadyRequested: true };
    const t = await this.prisma.supportTicket.create({
      data: {
        userId: u.id, category: 'DATA_DELETION', subject: 'Delete my account',
        messages: { create: { fromAdmin: false, authorId: u.id, body: body?.reason?.slice(0, 2000) || 'Please delete my account and personal data.' } },
      },
    });
    await this.audit.log({ type: 'USER', id: u.id }, { action: 'user.deletion_requested', entityType: 'User', entityId: u.id, meta: { ticketId: t.id } });
    await this.notifications.event('DELETION_REQUESTED', u.id, {}, { link: `/support/${t.id}` });
    return { ticketId: t.id, alreadyRequested: false };
  }
}
