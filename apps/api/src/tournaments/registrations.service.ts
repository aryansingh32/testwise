import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Tournament, User } from '@prisma/client';
import type { CheckoutDto, Eligibility, MyTournamentRowDto, MyTournamentStateDto } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { isMinor } from '../auth/user-mapper';
import { audienceReason } from '../common/eligibility';
import { XpService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { whenVar } from '../notifications/vars';
import { PaymentsService } from '../payments/payments.service';

type Reason = { en: string; hi: string };

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly payments: PaymentsService,
    private readonly xp: XpService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Check tournament eligibility rules against the student's profile and the age policy. */
  async eligibility(t: Tournament, user: User): Promise<Reason | null> {
    const el = (t.eligibility ?? {}) as Eligibility;
    const age = await this.config.get('policy.age');
    const exams = el.examIds?.length ? (await this.prisma.userExam.findMany({ where: { userId: user.id }, select: { examId: true } })).map((e) => e.examId) : [];
    const audienceIssue = audienceReason(el, user, exams);
    if (audienceIssue) return audienceIssue;
    if (el.requiresVerifiedEmail) {
      return { en: 'Requires a verified email, which arrives with the new sign-in system.', hi: 'सत्यापित ईमेल आवश्यक है, जो नए साइन-इन सिस्टम के साथ आएगा।' };
    }
    const minor = isMinor(user, age.adultAge);
    if (t.entryMode === 'PAID' && minor && !age.minorPaidEntryAllowed) {
      return { en: `Paid tournaments are for students aged ${age.adultAge}+.`, hi: `सशुल्क टूर्नामेंट ${age.adultAge}+ आयु के छात्रों के लिए हैं।` };
    }
    if (minor && (t.proctorMode === 'AI' || t.proctorMode === 'LIVE')) {
      const proctoring = await this.config.get('proctoring.policy');
      if (proctoring.enabled && !proctoring.allowMinors) {
        return { en: 'This tournament uses camera and microphone proctoring, which is open to adults only.', hi: 'इस टूर्नामेंट में कैमरा और माइक से निगरानी होती है, जो केवल वयस्कों के लिए है।' };
      }
    }
    if (minor && age.minorRequiresGuardianConsent && !user.guardianConsent) {
      return { en: 'Parent or guardian consent is required.', hi: 'माता-पिता या अभिभावक की सहमति आवश्यक है।' };
    }
    return null;
  }

  private async load(slug: string) {
    const t = await this.prisma.tournament.findUnique({ where: { slug } });
    if (!t || t.status === 'DRAFT') throw new NotFoundException('Tournament not found');
    return t;
  }

  async state(userId: string, slug: string): Promise<MyTournamentStateDto> {
    const t = await this.load(slug);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const [reg, attempt, finalVersion, provisional] = await Promise.all([
      this.prisma.registration.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId } }, include: { order: true } }),
      this.prisma.attempt.findFirst({ where: { tournamentId: t.id, userId } }),
      this.prisma.resultVersion.findFirst({ where: { tournamentId: t.id, status: { in: ['FINAL', 'PROVISIONAL'] } } }),
      this.config.get('results.policy'),
    ]);
    const reason = await this.eligibility(t, user);
    const active = reg && reg.status !== 'CANCELLED';
    const pendingPayable = reg?.status === 'PENDING_PAYMENT' && reg.order?.status === 'CREATED' && reg.order.expiresAt > new Date();
    const { allowStudentCancelPaidEntry } = await this.config.get('payments.policy');
    return {
      registration: reg ? { id: reg.id, status: reg.status, orderId: reg.orderId, createdAt: reg.createdAt.toISOString() } : null,
      eligible: !reason,
      ineligibleReasonEn: reason?.en ?? null,
      ineligibleReasonHi: reason?.hi ?? null,
      canRegister: t.status === 'REG_OPEN' && !reason && (!active || !!pendingPayable),
      canCancel:
        t.status === 'REG_OPEN' && !!active && (reg!.status !== 'CONFIRMED' || t.entryMode === 'FREE' || allowStudentCancelPaidEntry),
      canStart: t.status === 'LIVE' && reg?.status === 'CONFIRMED' && (!attempt || attempt.status === 'IN_PROGRESS') && t.endsAt > new Date(),
      attempt: attempt ? { id: attempt.id, status: attempt.status, score: attempt.status === 'IN_PROGRESS' ? null : attempt.score } : null,
      resultAvailable: !!finalVersion || (t.status === 'LIVE' && provisional.showLiveLeaderboard) || !!attempt,
    };
  }

  async register(userId: string, slug: string, input: { couponCode?: string | null; idempotencyKey: string }): Promise<{ status: string; checkout: CheckoutDto | null }> {
    const t = await this.load(slug);
    if (t.status !== 'REG_OPEN') throw new ConflictException('Registration is not open');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const reason = await this.eligibility(t, user);
    if (reason) throw new ForbiddenException(reason.en);
    if (t.entryMode === 'PAID') {
      const money = await this.config.get('policy.money');
      if (!money.paidEntryEnabled) throw new ForbiddenException('Paid entry is currently disabled');
    }

    const existing = await this.prisma.registration.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId } }, include: { order: true } });
    if (existing && ['CONFIRMED', 'WAITLISTED'].includes(existing.status)) return { status: existing.status, checkout: null };
    if (existing?.status === 'PENDING_PAYMENT' && existing.order?.status === 'CREATED' && existing.order.expiresAt > new Date()) {
      return { status: existing.status, checkout: await this.payments.checkout(existing.order) };
    }

    const { waitlistEnabled } = await this.config.get('payments.policy');
    const xpCfg = await this.config.get('gamification.xp');

    const result = await this.payments.singleFlight(input.idempotencyKey, () => this.prisma.$transaction(async (tx) => {
      // Lock the tournament row so concurrent registrations cannot oversell seats.
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${t.id} FOR UPDATE`;
      const taken = await tx.registration.count({
        where: {
          tournamentId: t.id,
          OR: [{ status: 'CONFIRMED' }, { status: 'PENDING_PAYMENT', order: { status: 'CREATED', expiresAt: { gt: new Date() } } }],
        },
      });
      const full = taken >= t.maxParticipants;

      if (t.entryMode === 'FREE') {
        if (full && !waitlistEnabled) throw new ConflictException('This tournament is full');
        const status = full ? 'WAITLISTED' : 'CONFIRMED';
        const reg = await tx.registration.upsert({
          where: { tournamentId_userId: { tournamentId: t.id, userId } },
          create: { tournamentId: t.id, userId, status },
          update: { status, cancelReason: null, orderId: null },
        });
        if (status === 'CONFIRMED') await this.xp.award(userId, xpCfg.perTournamentJoined, 'tournament', t.id, tx);
        await this.notifications.event(status === 'CONFIRMED' ? 'TOURNAMENT_REGISTERED' : 'TOURNAMENT_WAITLISTED', userId, { tournament: { en: t.titleEn, hi: t.titleHi }, startsAt: whenVar(t.startsAt) }, { link: `/tournament/${t.slug}`, tx });
        return { status, order: null };
      }

      if (full) throw new ConflictException('This tournament is full');
      const reg = await tx.registration.upsert({
        where: { tournamentId_userId: { tournamentId: t.id, userId } },
        create: { tournamentId: t.id, userId, status: 'PENDING_PAYMENT' },
        update: { status: 'PENDING_PAYMENT', cancelReason: null, orderId: null },
      });
      // Coin-only: entry is paid from the wallet; short balance throws "Not enough coins" and rolls the whole registration back.
      const order = await this.payments.createCoinOrder(
        { userId, kind: 'TOURNAMENT_ENTRY', refId: reg.id, descriptionEn: `Entry: ${t.titleEn}`, amountPaise: t.entryFeePaise, couponCode: input.couponCode, idempotencyKey: input.idempotencyKey },
        tx,
      );
      await tx.registration.update({ where: { id: reg.id }, data: { orderId: order.id } });
      if (order.status === 'PAID') await this.payments.fulfill(order.id, tx);
      return { status: order.status === 'PAID' ? 'CONFIRMED' : 'PENDING_PAYMENT', order };
    }));

    await this.audit.log({ type: 'USER', id: userId }, { action: 'registration.create', entityType: 'Tournament', entityId: t.id, meta: { status: result.status } });
    return { status: result.status, checkout: result.order ? await this.payments.checkout(result.order) : null };
  }

  async cancel(userId: string, slug: string) {
    const t = await this.load(slug);
    if (t.status !== 'REG_OPEN') throw new ConflictException('Registrations can only be cancelled while registration is open');
    const reg = await this.prisma.registration.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId } }, include: { order: true } });
    if (!reg || reg.status === 'CANCELLED') throw new NotFoundException('You are not registered');

    if (reg.status === 'CONFIRMED' && reg.order?.status === 'PAID') {
      const { allowStudentCancelPaidEntry } = await this.config.get('payments.policy');
      if (!allowStudentCancelPaidEntry) throw new ForbiddenException('Paid registrations cannot be cancelled by students; contact support');
      await this.payments.requestRefund(reg.order.id, undefined, 'Cancelled by student before registration closed', { type: 'SYSTEM' }, true);
    } else {
      if (reg.order?.status === 'CREATED') await this.prisma.order.update({ where: { id: reg.order.id }, data: { status: 'CANCELLED', failureReason: 'Registration cancelled' } });
      await this.prisma.registration.update({ where: { id: reg.id }, data: { status: 'CANCELLED', cancelReason: 'Cancelled by student' } });
    }
    await this.audit.log({ type: 'USER', id: userId }, { action: 'registration.cancel', entityType: 'Tournament', entityId: t.id });
    await this.notifications.event('TOURNAMENT_REGISTRATION_CANCELLED', userId, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}` });
    if (reg.status === 'CONFIRMED' && t.entryMode === 'FREE') await this.promoteWaitlist(t.id);
    return this.state(userId, slug);
  }

  /** Move the earliest waitlisted students into free seats (free tournaments only). */
  async promoteWaitlist(tournamentId: string) {
    const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (t.entryMode !== 'FREE') return 0;
    const confirmed = await this.prisma.registration.count({ where: { tournamentId, status: 'CONFIRMED' } });
    const free = t.maxParticipants - confirmed;
    if (free <= 0) return 0;
    const next = await this.prisma.registration.findMany({ where: { tournamentId, status: 'WAITLISTED' }, orderBy: { createdAt: 'asc' }, take: free });
    const xpCfg = await this.config.get('gamification.xp');
    for (const r of next) {
      await this.prisma.registration.update({ where: { id: r.id }, data: { status: 'CONFIRMED' } });
      await this.xp.award(r.userId, xpCfg.perTournamentJoined, 'tournament', tournamentId);
      await this.notifications.event('TOURNAMENT_WAITLIST_PROMOTED', r.userId, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}` });
    }
    return next.length;
  }

  /** On cancellation: refund every paid registration and release everyone. */
  async cancelAll(tournamentId: string, reason: string) {
    const regs = await this.prisma.registration.findMany({ where: { tournamentId, status: { not: 'CANCELLED' } }, include: { order: true } });
    for (const r of regs) {
      if (r.order?.status === 'PAID' || r.order?.status === 'REFUND_PENDING') {
        try {
          await this.payments.requestRefund(r.order.id, undefined, `Tournament cancelled: ${reason}`, { type: 'SYSTEM' }, true);
        } catch {
          /* already refunding or failed; visible in Finance */
        }
      } else if (r.order?.status === 'CREATED') {
        await this.prisma.order.update({ where: { id: r.order.id }, data: { status: 'CANCELLED', failureReason: 'Tournament cancelled' } });
      }
      await this.prisma.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelReason: `Tournament cancelled: ${reason}` } });
    }
    return regs.length;
  }

  async mine(userId: string): Promise<MyTournamentRowDto[]> {
    const regs = await this.prisma.registration.findMany({
      where: { userId, status: { not: 'CANCELLED' } },
      include: { tournament: true },
      orderBy: { tournament: { startsAt: 'desc' } },
    });
    const ids = regs.map((r) => r.tournamentId);
    const [attempts, entries] = await Promise.all([
      this.prisma.attempt.findMany({ where: { userId, tournamentId: { in: ids } } }),
      this.prisma.resultEntry.findMany({ where: { userId, version: { tournamentId: { in: ids }, status: { in: ['PROVISIONAL', 'FINAL'] } } }, include: { version: true } }),
    ]);
    return regs.map((r) => {
      const a = attempts.find((x) => x.tournamentId === r.tournamentId);
      const e = entries.find((x) => x.version.tournamentId === r.tournamentId);
      return {
        id: r.tournament.id, slug: r.tournament.slug, titleEn: r.tournament.titleEn, titleHi: r.tournament.titleHi,
        status: r.tournament.status, startsAt: r.tournament.startsAt.toISOString(), endsAt: r.tournament.endsAt.toISOString(),
        bannerColor: r.tournament.bannerColor, registrationStatus: r.status, attemptStatus: a?.status ?? null,
        rank: e?.rank ?? null, score: e ? e.score + e.adjustment : a?.score ?? null,
      };
    });
  }
}
