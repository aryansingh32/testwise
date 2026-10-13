import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { levelForXp, type CoinRewardsDto } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import { istDateKey, istDayStart } from './engagement.services';

/**
 * Coin rewards for learning and playing (daily check-in, streak milestones, level-ups, missions). Every amount is
 * decided here from server data; the app can only ask to claim. Each grant has a unique ledger key, so repeating a
 * request, retrying after a crash or two phones claiming at once pays exactly once, and a daily cap bounds farming.
 */
@Injectable()
export class GameCoinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  private async earnedToday(userId: string) {
    const rows = await this.prisma.walletTxn.aggregate({ where: { userId, type: 'GAME_REWARD', createdAt: { gte: istDayStart() } }, _sum: { earnedDelta: true } });
    return rows._sum.earnedDelta ?? 0;
  }

  /** Grant up to `coins`, limited by the daily cap. Returns the coins actually granted (0 if capped or already given). */
  private async grant(userId: string, coins: number, key: string, memo: { en: string; hi: string }, cap: number): Promise<number> {
    if (coins <= 0) return 0;
    const seen = await this.prisma.walletTxn.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (seen) return 0;
    const room = Math.max(0, cap - (await this.earnedToday(userId)));
    const amount = Math.min(coins, room);
    if (amount <= 0) return 0;
    let txn;
    try {
      txn = await this.prisma.$transaction((tx) => this.wallet.earn(tx, userId, amount, 'GAME_REWARD', { memo: memo.en, refType: 'GameReward', refId: key, idempotencyKey: key }));
    } catch (e) {
      // Two devices claiming at once: the loser hits the unique ledger key and the whole grant rolls back.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 0;
      throw e;
    }
    if (!txn || ('replayed' in txn && txn.replayed)) return 0;
    await this.notifications.event('COINS_CREDITED', userId, { coins: amount, reason: memo }, { link: '/wallet' }).catch(() => undefined);
    return amount;
  }

  private async enabled() {
    const [c, ws] = await Promise.all([this.config.get('gamification.coins'), this.wallet.settings()]);
    return { c, on: c.enabled && ws.enabled };
  }

  /** Level-ups and streak milestones the student has reached. Only recent levels are paid, so switching this on cannot flood an old account. */
  async sync(userId: string) {
    const { c, on } = await this.enabled();
    if (!on) return;
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true, streakDays: true, lastActiveOn: true } });
    const { level } = levelForXp(u.xp, c.xpPerLevel);
    for (let lvl = Math.max(2, level - 1); lvl <= level; lvl++) {
      await this.grant(userId, Math.min(c.levelUpCoinsBase * lvl, c.levelUpCoinsMax), `game:level:${userId}:${lvl}`, { en: `Level ${lvl} reached!`, hi: `लेवल ${lvl} पर पहुँचे!` }, c.dailyEarnCap);
    }
    if (u.streakDays > 0 && u.lastActiveOn) {
      const runStart = new Date(u.lastActiveOn.getTime() - (u.streakDays - 1) * 86_400_000).toISOString().slice(0, 10);
      for (const m of c.streakMilestones.filter((x) => u.streakDays >= x.days)) {
        await this.grant(userId, m.coins, `game:streak:${userId}:${runStart}:${m.days}`, { en: `${m.days}-day streak!`, hi: `${m.days} दिन की स्ट्रीक!` }, c.dailyEarnCap);
      }
    }
  }

  async missionCompleted(userId: string, missionId: string, day: string) {
    const { c, on } = await this.enabled();
    if (!on) return 0;
    return this.grant(userId, c.missionCoins, `game:mission:${userId}:${missionId}:${day}`, { en: 'Mission complete!', hi: 'मिशन पूरा!' }, c.dailyEarnCap);
  }

  async rewards(userId: string): Promise<CoinRewardsDto> {
    const { c, on } = await this.enabled();
    await this.sync(userId);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { xp: true, streakDays: true } });
    const day = istDateKey();
    const claimed = !!(await this.prisma.walletTxn.findUnique({ where: { idempotencyKey: `game:daily:${userId}:${day}` }, select: { id: true } }));
    const streak = Math.max(1, u.streakDays);
    const cycleDay = ((streak - 1) % 7) + 1;
    const lv = levelForXp(u.xp, c.xpPerLevel);
    return {
      enabled: on,
      daily: { cycleDay, rewards: c.dailyRewards, claimable: on && !claimed, claimedToday: claimed, streak: u.streakDays, todayCoins: c.dailyRewards[cycleDay - 1] },
      level: { level: lv.level, xp: u.xp, xpIntoLevel: lv.xpIntoLevel, xpForNext: lv.xpForNext, progressPct: lv.progressPct },
      milestones: c.streakMilestones.map((m) => ({ days: m.days, coins: m.coins, reached: u.streakDays >= m.days })),
      earnedTodayCoins: await this.earnedToday(userId),
      dailyEarnCap: c.dailyEarnCap,
    };
  }

  /** Claim today's check-in. The amount is read from the config and the student's streak on the server. */
  async claimDaily(userId: string): Promise<CoinRewardsDto & { granted: number }> {
    const { c, on } = await this.enabled();
    if (!on) throw new ForbiddenException('Coin rewards are not available yet');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { streakDays: true, status: true } });
    if (u.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot claim rewards');
    const day = istDateKey();
    const cycleDay = ((Math.max(1, u.streakDays) - 1) % 7) + 1;
    const granted = await this.grant(userId, c.dailyRewards[cycleDay - 1], `game:daily:${userId}:${day}`, { en: `Day ${cycleDay} check-in`, hi: `दिन ${cycleDay} चेक-इन` }, c.dailyEarnCap);
    const done = await this.prisma.walletTxn.findUnique({ where: { idempotencyKey: `game:daily:${userId}:${day}` }, select: { id: true } });
    if (!granted && !done) throw new ConflictException('You have reached today’s coin limit. Come back tomorrow.');
    return { ...(await this.rewards(userId)), granted };
  }
}
