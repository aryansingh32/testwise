import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Eligibility } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../common/prisma.service';
import { istDateKey } from '../engagement/engagement.services';
import { CampaignsService } from './campaigns.service';
import { NotificationsService } from './notifications.service';

/** Bilingual "in N minutes/hours/days" for templates. */
export function durationVar(minutes: number) {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return { en: `${d} day${d === 1 ? '' : 's'}`, hi: `${d} दिन` };
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return { en: `${h} hour${h === 1 ? '' : 's'}`, hi: `${h} घंटे` };
  }
  return { en: `${minutes} min`, hi: `${minutes} मिनट` };
}

/**
 * Automatic reminders and alerts, run every minute. Each reminder is recorded in
 * ReminderLog so it is sent once, even across restarts.
 */
@Injectable()
export class NotificationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
    private readonly campaigns: CampaignsService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.redis.withLock('job:notification-scheduler', 120_000, () => this.tick());
    this.timer = setInterval(run, 30_000);
    setTimeout(run, 5000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Claim a reminder key; returns false if it was already sent. */
  private async once(key: string) {
    try {
      await this.prisma.reminderLog.create({ data: { key } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const s = await this.config.get('notifications.schedule');
      this.notifications.quietHours = { start: s.quietHoursStartIst, end: s.quietHoursEndIst };
      await this.campaignsDue();
      await this.startReminders(s.tournamentStartReminders);
      if (s.tournamentEndingReminderMinutes > 0) await this.endingReminders(s.tournamentEndingReminderMinutes);
      if (s.registrationClosingReminderMinutes > 0) await this.closingReminders(s.registrationClosingReminderMinutes);
      if (s.seatsFillingPercent > 0) await this.seatsFilling(s.seatsFillingPercent);
      if (s.newTournamentAlerts) await this.newTournaments();
      if (s.streakReminderHourIst >= 0) await this.streaks(s.streakReminderHourIst);
      if (s.accessExpiringDays > 0) await this.expiring(s.accessExpiringDays);
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
  }

  private async campaignsDue() {
    const due = await this.prisma.notificationCampaign.findMany({ where: { status: 'SCHEDULED', sendAt: { lte: new Date() } }, select: { id: true } });
    for (const c of due) await this.campaigns.dispatch(c.id);
  }

  private tVar(t: { titleEn: string; titleHi: string | null }) {
    return { en: t.titleEn, hi: t.titleHi };
  }

  /** One reminder per offset; if several offsets are already due, send only the nearest. */
  private async startReminders(offsets: number[]) {
    if (!offsets.length) return;
    const max = Math.max(...offsets);
    const now = Date.now();
    const soon = await this.prisma.tournament.findMany({
      where: { status: { in: ['REG_OPEN', 'REG_CLOSED', 'SCHEDULED'] }, startsAt: { gt: new Date(now), lte: new Date(now + max * 60_000) } },
    });
    for (const t of soon) {
      const due = offsets.filter((o) => now >= t.startsAt.getTime() - o * 60_000).sort((a, b) => a - b);
      if (!due.length) continue;
      const fresh = [];
      for (const o of due) if (await this.once(`t:${t.id}:start:${o}`)) fresh.push(o);
      if (!fresh.includes(due[0])) continue;
      const minutes = Math.max(1, Math.round((t.startsAt.getTime() - now) / 60_000));
      await this.notifications.eventToTournament('TOURNAMENT_STARTING_SOON', t.id, { tournament: this.tVar(t), minutes: durationVar(minutes <= due[0] ? due[0] : minutes) }, { link: `/tournament/${t.slug}` });
    }
  }

  private async endingReminders(minutes: number) {
    const now = Date.now();
    const live = await this.prisma.tournament.findMany({ where: { status: 'LIVE', endsAt: { gt: new Date(now), lte: new Date(now + minutes * 60_000) } } });
    for (const t of live) {
      if (!(await this.once(`t:${t.id}:ending`))) continue;
      const regs = await this.prisma.registration.findMany({ where: { tournamentId: t.id, status: 'CONFIRMED' }, select: { userId: true } });
      const done = await this.prisma.attempt.findMany({ where: { tournamentId: t.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { userId: true } });
      const finished = new Set(done.map((d) => d.userId));
      const left = Math.max(1, Math.round((t.endsAt.getTime() - now) / 60_000));
      await this.notifications.eventToUsers('TOURNAMENT_ENDING_SOON', regs.map((r) => r.userId).filter((u) => !finished.has(u)), { tournament: this.tVar(t), minutes: durationVar(left) }, { link: `/tournament/${t.slug}` });
    }
  }

  /** Students who follow the tournament's exam, match its audience/class and haven't registered. */
  private async prospects(t: { id: string; examId: string | null; eligibility: Prisma.JsonValue }) {
    if (!t.examId) return [];
    const el = (t.eligibility ?? {}) as Eligibility;
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        exams: { some: { examId: t.examId } },
        registrations: { none: { tournamentId: t.id } },
        ...(el.audience?.length && { audience: { in: el.audience } }),
        ...(el.classLevels?.length && { classLevel: { in: el.classLevels } }),
      },
      select: { id: true },
      take: 50_000,
    });
    return users.map((u) => u.id);
  }

  private async closingReminders(minutes: number) {
    const now = Date.now();
    const closing = await this.prisma.tournament.findMany({ where: { status: 'REG_OPEN', registrationClosesAt: { gt: new Date(now), lte: new Date(now + minutes * 60_000) } } });
    for (const t of closing) {
      if (!(await this.once(`t:${t.id}:closing`))) continue;
      const left = Math.max(1, Math.round((t.registrationClosesAt.getTime() - now) / 60_000));
      await this.notifications.eventToUsers('REGISTRATION_CLOSING_SOON', await this.prospects(t), { tournament: this.tVar(t), minutes: durationVar(left) }, { link: `/tournament/${t.slug}` });
    }
  }

  private async seatsFilling(percent: number) {
    const open = await this.prisma.tournament.findMany({ where: { status: 'REG_OPEN' }, include: { _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } } } });
    for (const t of open) {
      const pct = Math.floor((t._count.registrations / t.maxParticipants) * 100);
      if (pct < percent || pct >= 100) continue;
      if (!(await this.once(`t:${t.id}:seats:${percent}`))) continue;
      await this.notifications.eventToUsers(
        'SEATS_FILLING_FAST',
        await this.prospects(t),
        { tournament: this.tVar(t), percent: pct, seatsLeft: t.maxParticipants - t._count.registrations },
        { link: `/tournament/${t.slug}` },
      );
    }
  }

  private async newTournaments() {
    const recent = await this.prisma.tournament.findMany({
      where: { status: { in: ['SCHEDULED', 'REG_OPEN'] }, publishedAt: { gte: new Date(Date.now() - 2 * 86_400_000) }, examId: { not: null } },
      include: { exam: { select: { nameEn: true, nameHi: true } } },
    });
    for (const t of recent) {
      if (!(await this.once(`t:${t.id}:new`))) continue;
      await this.notifications.eventToUsers('NEW_TOURNAMENT', await this.prospects(t), { tournament: this.tVar(t), exam: { en: t.exam!.nameEn, hi: t.exam!.nameHi } }, { link: `/tournament/${t.slug}` });
    }
  }

  private async streaks(hourIst: number) {
    const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours();
    if (istHour !== hourIst) return;
    const day = istDateKey();
    if (!(await this.once(`streak:${day}`))) return;
    const todayUtc = new Date(new Date().toISOString().slice(0, 10));
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', streakDays: { gte: 1 }, lastActiveOn: { lt: todayUtc } },
      select: { id: true, streakDays: true },
    });
    const byDays = new Map<number, string[]>();
    for (const u of users) byDays.set(u.streakDays, [...(byDays.get(u.streakDays) ?? []), u.id]);
    for (const [days, ids] of byDays) await this.notifications.eventToUsers('STREAK_REMINDER', ids, { days }, { link: '/home' });
  }

  private async expiring(days: number) {
    const soon = await this.prisma.enrollment.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date(), lte: new Date(Date.now() + days * 86_400_000) } },
      include: { series: { select: { titleEn: true, titleHi: true, slug: true } } },
    });
    for (const e of soon) {
      if (!(await this.once(`enr:${e.id}:${e.expiresAt.toISOString().slice(0, 10)}`))) continue;
      const left = Math.max(1, Math.ceil((e.expiresAt.getTime() - Date.now()) / 86_400_000));
      await this.notifications.event('ACCESS_EXPIRING', e.userId, { series: { en: e.series.titleEn, hi: e.series.titleHi }, days: left }, { link: `/series/${e.series.slug}` });
    }
  }
}
