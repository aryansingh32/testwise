import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Duel } from '@prisma/client';
import type { DuelHistoryDto, DuelLeaderRowDto, DuelProfileDto } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { isMinor } from '../auth/user-mapper';
import { WalletService } from '../wallet/wallet.service';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { publicName, XpService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { eloUpdate, inviteCode, tierFor } from './duel-logic';
import { PaidDuelsService } from './paid-duels.service';

export interface DuelQuestion {
  id: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  textEn: string;
  textHi: string | null;
  imageUrl: string | null;
  options: { label: string; textEn: string; textHi: string | null }[];
  correct: string;
}

/** Persistence, ratings, history, leaderboards and friend challenges for duels. */
@Injectable()
export class DuelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly xp: XpService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly paid: PaidDuelsService,
  ) {}

  settings() {
    return this.config.get('duels.settings');
  }

  async ensureEnabled() {
    const flags = await this.config.get('features.flags');
    if (!flags.duels) throw new ForbiddenException('Duels are currently disabled');
  }

  async displayName(userId: string) {
    const [u, policy, age] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, dateOfBirth: true, audience: true, duelRating: true } }),
      this.config.get('results.policy'),
      this.config.get('policy.age'),
    ]);
    return { name: publicName(u.displayName, isMinor(u, age.adultAge), policy.hideMinorNames), rating: u.duelRating };
  }

  /** Random approved single-answer questions, preferring the chosen exam. */
  async pickQuestions(examId: string | null, count: number): Promise<DuelQuestion[]> {
    const pick = async (where: Prisma.QuestionWhereInput, n: number, exclude: string[]) => {
      if (n <= 0) return [];
      const ids = await this.prisma.question.findMany({ where: { ...where, status: 'APPROVED', type: 'MCQ_SINGLE', id: { notIn: exclude } }, select: { id: true }, take: 3000 });
      const chosen = ids.sort(() => Math.random() - 0.5).slice(0, n).map((q) => q.id);
      return this.prisma.question.findMany({ where: { id: { in: chosen } }, include: { options: { orderBy: { sortOrder: 'asc' } } } });
    };
    const first = examId ? await pick({ examId }, count, []) : [];
    const rest = await pick({}, count - first.length, first.map((q) => q.id));
    const all = [...first, ...rest];
    if (all.length < count) throw new ConflictException('Not enough approved questions for a duel yet');
    return all.map((q) => ({
      id: q.id, difficulty: q.difficulty, textEn: q.textEn, textHi: q.textHi, imageUrl: q.imageUrl,
      options: [...q.options].sort(() => Math.random() - 0.5).map((o) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi })),
      correct: q.correctLabels[0],
    }));
  }

  async randomPersona(near: number, adaptive: boolean) {
    const personas = await this.prisma.botPersona.findMany({ where: { active: true } });
    if (!personas.length) return null;
    const fitting = personas.filter((p) => near >= p.ratingMin - 100 && near <= p.ratingMax + 100);
    const persona = (fitting.length ? fitting : personas)[Math.floor(Math.random() * (fitting.length || personas.length))];
    const rating = adaptive ? Math.max(100, near + Math.round((Math.random() - 0.5) * 100)) : Math.round(persona.ratingMin + Math.random() * (persona.ratingMax - persona.ratingMin));
    return { persona, rating };
  }

  /**
   * Apply results: ratings (ranked only), win/loss records, XP and notifications.
   * Bots have no stored rating; only the human's rating moves.
   */
  async finish(duel: Duel, scoreA: number, scoreB: number) {
    const s = await this.settings();
    const winner = scoreA === scoreB ? 'DRAW' : scoreA > scoreB ? 'A' : 'B';
    const players = await this.prisma.user.findMany({ where: { id: { in: [duel.playerAId, duel.playerBId].filter(Boolean) as string[] } } });
    const A = players.find((p) => p.id === duel.playerAId)!;
    const B = duel.playerBId ? players.find((p) => p.id === duel.playerBId)! : null;
    const ratedA = duel.ratingABefore ?? A.duelRating;
    const ratedB = duel.ratingBBefore ?? B?.duelRating ?? duel.botRating ?? s.startingRating;
    const resA: 0 | 0.5 | 1 = winner === 'DRAW' ? 0.5 : winner === 'A' ? 1 : 0;
    const ranked = duel.mode === 'RANKED';
    const afterA = ranked ? eloUpdate(ratedA, ratedB, resA, s.ratingK) : ratedA;
    const afterB = ranked && B ? eloUpdate(ratedB, ratedA, (1 - resA) as 0 | 0.5 | 1, s.ratingK) : ratedB;
    const isBot = !duel.playerBId;
    const xpFor = (r: 0 | 0.5 | 1) => (isBot && !s.xpFromBotDuels ? 0 : r === 1 ? s.xpWin : r === 0.5 ? s.xpDraw : s.xpLoss);

    const updateStats = (u: { id: string; duelStreak: number }, r: 0 | 0.5 | 1, rating: number) =>
      this.prisma.user.update({
        where: { id: u.id },
        data: {
          duelRating: rating,
          ...(r === 1 ? { duelWins: { increment: 1 }, duelStreak: Math.max(0, u.duelStreak) + 1 } : r === 0 ? { duelLosses: { increment: 1 }, duelStreak: 0 } : { duelDraws: { increment: 1 } }),
        },
      });

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.duel.updateMany({
        where: { id: duel.id, status: 'ACTIVE' },
        data: { status: 'FINISHED', finishedAt: new Date(), scoreA, scoreB, winner, ratingABefore: ratedA, ratingAAfter: afterA, ratingBBefore: ratedB, ratingBAfter: B ? afterB : null },
      });
      if (!res.count) return false;
      return true;
    });
    if (!updated) return null;
    await updateStats(A, resA, afterA);
    if (B) await updateStats(B, (1 - resA) as 0 | 0.5 | 1, afterB);
    const xpA = await this.xp.award(A.id, xpFor(resA), 'duel', duel.id);
    const xpB = B ? await this.xp.award(B.id, xpFor((1 - resA) as 0 | 0.5 | 1), 'duel', duel.id) : 0;

    // Wallet coins for beating a real person. Never for bot duels: a bot win must not be worth money.
    // Coin duels pay from escrow, decided by this server-side result and nothing the apps sent.
    if (duel.mode === 'PAID') await this.paid.settle(duel.id, winner as 'A' | 'B' | 'DRAW');
    else if (B && winner !== 'DRAW') {
      const ws = await this.wallet.settings();
      if (ws.enabled && ws.duelWinCoins > 0) {
        const winnerId = winner === 'A' ? A.id : B.id;
        await this.prisma.$transaction((tx) =>
          this.wallet.earn(tx, winnerId, ws.duelWinCoins, 'EARN_DUEL', { memo: 'Duel win', refType: 'Duel', refId: duel.id, idempotencyKey: `duel:${duel.id}` }),
        );
        await this.notifications.event('COINS_CREDITED', winnerId, { coins: ws.duelWinCoins, reason: { en: 'You won a 1v1 duel!', hi: 'आपने 1v1 मुकाबला जीता!' } }, { link: '/wallet' });
      }
    }

    // Notifications: result (inbox by default) and league promotions.
    const nameA = await this.displayName(A.id);
    const nameB = B ? await this.displayName(B.id) : { name: (await this.prisma.botPersona.findUnique({ where: { id: duel.botPersonaId ?? '' } }))?.name ?? 'Opponent', rating: ratedB };
    const outcome = (r: 0 | 0.5 | 1) => (r === 1 ? { en: 'You won 🏆', hi: 'आप जीते 🏆' } : r === 0 ? { en: 'You lost', hi: 'आप हारे' } : { en: 'Draw', hi: 'बराबरी' });
    await this.notifications.event('DUEL_RESULT', A.id, { opponent: nameB.name, outcome: outcome(resA), rating: afterA }, { link: '/duels' });
    if (B) await this.notifications.event('DUEL_RESULT', B.id, { opponent: nameA.name, outcome: outcome((1 - resA) as 0 | 0.5 | 1), rating: afterB }, { link: '/duels' });
    for (const [u, before, after] of [[A, ratedA, afterA], ...(B ? [[B, ratedB, afterB]] : [])] as [{ id: string }, number, number][]) {
      const t0 = tierFor(before, s.tiers);
      const t1 = tierFor(after, s.tiers);
      if (t1.index > t0.index) await this.notifications.event('DUEL_TIER_UP', u.id, { tier: { en: t1.tier.name, hi: t1.tier.nameHi } }, { link: '/duels' });
    }
    return { winner, ratedA, ratedB, afterA, afterB, xpA, xpB };
  }

  // ------------------------------------------------------------- Read models

  async profile(userId: string): Promise<DuelProfileDto> {
    const s = await this.settings();
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const played = u.duelWins + u.duelLosses + u.duelDraws;
    const rank = played ? (await this.prisma.user.count({ where: { duelRating: { gt: u.duelRating }, OR: [{ duelWins: { gt: 0 } }, { duelLosses: { gt: 0 } }, { duelDraws: { gt: 0 } }] } })) + 1 : null;
    const { tier, next } = tierFor(u.duelRating, s.tiers);
    return {
      rating: u.duelRating, wins: u.duelWins, losses: u.duelLosses, draws: u.duelDraws, streak: u.duelStreak, rank,
      tier: { name: tier.name, nameHi: tier.nameHi, color: tier.color, nextName: next?.name ?? null, nextAt: next?.minRating ?? null },
    };
  }

  async history(userId: string): Promise<DuelHistoryDto[]> {
    const duels = await this.prisma.duel.findMany({
      where: { OR: [{ playerAId: userId }, { playerBId: userId }], status: { in: ['FINISHED', 'ABANDONED'] } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { botPersona: { select: { name: true } } },
    });
    const opponentIds = duels.map((d) => (d.playerAId === userId ? d.playerBId : d.playerAId)).filter(Boolean) as string[];
    const names = new Map<string, string>();
    for (const id of new Set(opponentIds)) names.set(id, (await this.displayName(id)).name);
    return duels.map((d) => {
      const mine = d.playerAId === userId ? 'A' : 'B';
      const oppId = mine === 'A' ? d.playerBId : d.playerAId;
      const before = mine === 'A' ? d.ratingABefore : d.ratingBBefore;
      const after = mine === 'A' ? d.ratingAAfter : d.ratingBAfter;
      return {
        id: d.id,
        opponentName: oppId ? names.get(oppId) ?? 'Player' : d.botPersona?.name ?? 'Player',
        outcome: d.status === 'ABANDONED' ? 'ABANDONED' : d.winner === 'DRAW' ? 'DRAW' : d.winner === mine ? 'WIN' : 'LOSS',
        yourScore: mine === 'A' ? d.scoreA : d.scoreB,
        opponentScore: mine === 'A' ? d.scoreB : d.scoreA,
        ratingChange: before != null && after != null ? after - before : 0,
        finishedAt: d.finishedAt?.toISOString() ?? null,
      };
    });
  }

  async leaderboard(userId: string, limit = 100): Promise<DuelLeaderRowDto[]> {
    const s = await this.settings();
    const [rows, policy, age] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE', OR: [{ duelWins: { gt: 0 } }, { duelLosses: { gt: 0 } }, { duelDraws: { gt: 0 } }] },
        orderBy: [{ duelRating: 'desc' }, { duelWins: 'desc' }],
        take: limit,
        select: { id: true, displayName: true, duelRating: true, duelWins: true, dateOfBirth: true, audience: true },
      }),
      this.config.get('results.policy'),
      this.config.get('policy.age'),
    ]);
    return rows.map((u, i) => {
      const { tier } = tierFor(u.duelRating, s.tiers);
      return { rank: i + 1, userId: u.id, name: publicName(u.displayName, isMinor(u, age.adultAge), policy.hideMinorNames), rating: u.duelRating, tier: tier.name, tierColor: tier.color, wins: u.duelWins, isMe: u.id === userId };
    });
  }

  // ------------------------------------------------------------- Friend challenges

  async createChallenge(userId: string, examId: string | null) {
    await this.ensureEnabled();
    const s = await this.settings();
    await this.prisma.duel.updateMany({ where: { playerAId: userId, mode: 'FRIEND', status: 'WAITING' }, data: { status: 'CANCELLED' } });
    for (let i = 0; i < 5; i++) {
      try {
        return await this.prisma.duel.create({
          data: { mode: 'FRIEND', status: 'WAITING', examId, inviteCode: inviteCode(), playerAId: userId, questionCount: s.questionCount, secondsPerQuestion: s.secondsPerQuestion },
          select: { id: true, inviteCode: true, createdAt: true },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new ConflictException('Could not create a challenge code, try again');
  }

  /** Friend enters a code: becomes player B. The engine starts the duel once both are online. */
  async joinChallenge(userId: string, code: string) {
    await this.ensureEnabled();
    const d = await this.prisma.duel.findUnique({ where: { inviteCode: code.toUpperCase().trim() } });
    if (!d || d.status !== 'WAITING' || d.createdAt < new Date(Date.now() - 30 * 60_000)) throw new NotFoundException('This challenge code is invalid or expired');
    if (d.playerAId === userId) throw new BadRequestException("You can't accept your own challenge");
    if (d.playerBId && d.playerBId !== userId) throw new ConflictException('Someone already accepted this challenge');
    const updated = await this.prisma.duel.update({ where: { id: d.id }, data: { playerBId: userId } });
    const me = await this.displayName(userId);
    await this.notifications.event('DUEL_CHALLENGE_ACCEPTED', d.playerAId, { opponent: me.name }, { link: `/duels/challenge/${d.id}` });
    return updated;
  }

  // ------------------------------------------------------------- Admin

  async stats() {
    const since = new Date(Date.now() - 86_400_000);
    const [today, active, bots, finishedVsBots, humanWinsVsBots, total, players] = await Promise.all([
      this.prisma.duel.count({ where: { createdAt: { gte: since } } }),
      this.prisma.duel.count({ where: { status: 'ACTIVE' } }),
      this.prisma.duel.count({ where: { createdAt: { gte: since }, botPersonaId: { not: null } } }),
      this.prisma.duel.count({ where: { status: 'FINISHED', botPersonaId: { not: null } } }),
      this.prisma.duel.count({ where: { status: 'FINISHED', botPersonaId: { not: null }, winner: 'A' } }),
      this.prisma.duel.count({ where: { status: 'FINISHED' } }),
      this.prisma.user.count({ where: { OR: [{ duelWins: { gt: 0 } }, { duelLosses: { gt: 0 } }, { duelDraws: { gt: 0 } }] } }),
    ]);
    return {
      duelsLast24h: today,
      activeNow: active,
      botShareLast24h: today ? Math.round((bots / today) * 1000) / 10 : 0,
      humanWinRateVsBots: finishedVsBots ? Math.round((humanWinsVsBots / finishedVsBots) * 1000) / 10 : 0,
      totalFinished: total,
      players,
    };
  }

  async recent() {
    const duels = await this.prisma.duel.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { botPersona: { select: { name: true } } } });
    const ids = [...new Set(duels.flatMap((d) => [d.playerAId, d.playerBId]).filter(Boolean) as string[])];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return duels.map(({ paper: _p, botSeed: _seed, ...d }) => ({ ...d, playerA: byId.get(d.playerAId) ?? null, playerB: d.playerBId ? byId.get(d.playerBId) ?? null : null, isBot: !!d.botPersonaId }));
  }

  personas() {
    return this.prisma.botPersona.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { duels: true } } } });
  }

  async savePersona(id: string | null, data: { name: string; city?: string | null; color: string; ratingMin: number; ratingMax: number; active: boolean }, actor: AuditActor) {
    const p = id ? await this.prisma.botPersona.update({ where: { id }, data }) : await this.prisma.botPersona.create({ data });
    await this.audit.log(actor, { action: id ? 'bot.update' : 'bot.create', entityType: 'BotPersona', entityId: p.id, after: p });
    return p;
  }

  async deletePersona(id: string, actor: AuditActor) {
    const used = await this.prisma.duel.count({ where: { botPersonaId: id } });
    if (used) await this.prisma.botPersona.update({ where: { id }, data: { active: false } });
    else await this.prisma.botPersona.delete({ where: { id } });
    await this.audit.log(actor, { action: 'bot.delete', entityType: 'BotPersona', entityId: id, meta: { deactivatedInstead: !!used } });
    return { ok: true, deactivated: !!used };
  }
}
