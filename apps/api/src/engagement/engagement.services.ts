import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MissionDto } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { PrismaService } from '../common/prisma.service';
import { GameCoinsService } from './game-coins.service';
import { NotificationsService } from '../notifications/notifications.service';

type Tx = Prisma.TransactionClient | PrismaService;

/** Start of the current day in India Standard Time, as a UTC Date. */
export function istDayStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}

export const istDateKey = (now = new Date()) => new Date(istDayStart(now).getTime() + 330 * 60_000).toISOString().slice(0, 10);

@Injectable()
export class XpService {
  constructor(private readonly prisma: PrismaService) {}

  /** Award XP once per (user, reason, refId). Returns the amount actually awarded (0 if already given). */
  async award(userId: string, amount: number, reason: string, refId: string, tx: Tx = this.prisma): Promise<number> {
    if (amount <= 0) return 0;
    // ON CONFLICT DO NOTHING: a unique violation would abort the surrounding Postgres transaction (a re-submitted
    // attempt would fail every later statement), so duplicates are skipped by the database instead of caught.
    const created = await tx.xpEvent.createMany({ data: [{ userId, amount, reason, refId }], skipDuplicates: true });
    if (!created.count) return 0;
    await tx.user.update({ where: { id: userId }, data: { xp: { increment: amount } } });
    return amount;
  }
}

@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly xp: XpService,
    private readonly notifications: NotificationsService,
    private readonly game: GameCoinsService,
  ) {}

  /** Today's mission progress; completes and rewards missions as a side effect (idempotent). */
  async forUser(userId: string): Promise<MissionDto[]> {
    const [{ missions }, flags] = await Promise.all([this.config.get('gamification.missions'), this.config.get('features.flags')]);
    if (!flags.dailyMissions) return [];
    const since = istDayStart();
    const day = istDateKey();
    const active = missions.filter((m) => m.active);
    if (!active.length) return [];

    // Opening Home counts as today's login.
    const [tests, correct, joined] = await Promise.all([
      this.prisma.attempt.count({ where: { userId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] }, submittedAt: { gte: since } } }),
      this.prisma.attempt.aggregate({ where: { userId, submittedAt: { gte: since } }, _sum: { correctCount: true } }),
      this.prisma.registration.count({ where: { userId, status: 'CONFIRMED', updatedAt: { gte: since } } }),
    ]);

    const out: MissionDto[] = [];
    for (const m of active) {
      const progress =
        m.type === 'COMPLETE_TESTS' ? tests : m.type === 'CORRECT_ANSWERS' ? correct._sum.correctCount ?? 0 : m.type === 'JOIN_TOURNAMENT' ? joined : 1;
      const done = progress >= m.target;
      if (done && (await this.xp.award(userId, m.xp, `mission:${m.id}`, day)) > 0) {
        await this.notifications.event('MISSION_COMPLETED', userId, { mission: { en: m.titleEn, hi: m.titleHi }, xp: m.xp }, { link: '/home' });
        await this.game.missionCompleted(userId, m.id, day).catch(() => undefined);
      }
      out.push({ id: m.id, titleEn: m.titleEn, titleHi: m.titleHi, target: m.target, progress: Math.min(progress, m.target), xp: m.xp, done });
    }
    return out;
  }
}

/** Public display name honouring the privacy policy for minors. */
export function publicName(name: string, minor: boolean, hideMinorNames: boolean): string {
  if (!minor || !hideMinorNames) return name;
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first;
}
