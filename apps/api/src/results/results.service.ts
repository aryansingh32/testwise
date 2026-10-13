import { WalletService } from '../wallet/wallet.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ResultEntry } from '@prisma/client';
import { formatRupees, type LeaderboardRowDto, type PrizeTier, type TournamentResultDto } from '@testwise/shared';
import { randomBytes } from 'crypto';
import { AppConfigService } from '../app-config/app-config.service';
import { isMinor } from '../auth/user-mapper';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { publicName, XpService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { rankEntries } from '../attempts/scoring';
import { Account, LedgerService } from '../payments/ledger.service';

type Override = { disqualified: boolean; dqReason: string | null; adjustment: number; adjustReason: string | null };

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly xp: XpService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  private async names(userIds: string[]) {
    const [users, policy, age] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, dateOfBirth: true, audience: true } }),
      this.config.get('results.policy'),
      this.config.get('policy.age'),
    ]);
    return new Map(users.map((u) => [u.id, publicName(u.displayName, isMinor(u, age.adultAge), policy.hideMinorNames)]));
  }

  private currentVersion(tournamentId: string) {
    return this.prisma.resultVersion.findFirst({
      where: { tournamentId, status: { in: ['PROVISIONAL', 'FINAL'] } },
      orderBy: { version: 'desc' },
      include: { entries: true },
    });
  }

  /**
   * Build a new result version from submitted attempts, carrying forward previous
   * disqualifications and score adjustments, plus an optional new override.
   */
  async generate(tournamentId: string, actor: AuditActor, change?: { userId: string } & Partial<Override>, notes?: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status !== 'IN_REVIEW') throw new ConflictException('Results can be prepared only while the tournament is in review');
    const prev = await this.currentVersion(tournamentId);
    const overrides = new Map<string, Override>(
      (prev?.entries ?? []).map((e) => [e.userId, { disqualified: e.disqualified, dqReason: e.dqReason, adjustment: e.adjustment, adjustReason: e.adjustReason }]),
    );
    // Disqualifications a proctor decided before any result existed are carried into the first version.
    if (!prev) {
      const dqs = await this.prisma.proctorAction.findMany({ where: { type: { in: ['DISQUALIFY', 'REINSTATE'] }, session: { tournamentId } }, orderBy: { createdAt: 'asc' } });
      // The latest decision per student wins: a later reinstatement cancels an earlier disqualification.
      for (const d of dqs) {
        if (d.type === 'DISQUALIFY') overrides.set(d.userId, { disqualified: true, dqReason: d.message ?? 'Disqualified by proctor', adjustment: 0, adjustReason: null });
        else overrides.delete(d.userId);
      }
    }
    if (change) {
      const cur = overrides.get(change.userId) ?? { disqualified: false, dqReason: null, adjustment: 0, adjustReason: null };
      overrides.set(change.userId, { ...cur, ...Object.fromEntries(Object.entries(change).filter(([k, v]) => k !== 'userId' && v !== undefined)) } as Override);
    }

    const attempts = await this.prisma.attempt.findMany({ where: { tournamentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } });
    if (change && !attempts.some((a) => a.userId === change.userId)) throw new BadRequestException('This student has no submitted attempt');
    const rows = attempts.map((a) => {
      const o = overrides.get(a.userId) ?? { disqualified: false, dqReason: null, adjustment: 0, adjustReason: null };
      return {
        userId: a.userId, attemptId: a.id, rawScore: a.score ?? 0, score: (a.score ?? 0) + o.adjustment, accuracy: a.accuracy ?? 0,
        timeTakenSec: a.timeTakenSec ?? 0, submittedAt: a.submittedAt ?? a.deadlineAt, ...o,
      };
    });
    const ranked = rankEntries(rows);
    const tiers = ((t.prizeTiers as unknown as PrizeTier[]) ?? []).sort((a, b) => a.fromRank - b.fromRank);
    const prizeFor = (rank: number | null) => (rank == null ? undefined : tiers.find((x) => rank >= x.fromRank && rank <= x.toRank));

    const version = await this.prisma.$transaction(async (tx) => {
      await tx.resultVersion.updateMany({ where: { tournamentId, status: 'PROVISIONAL' }, data: { status: 'SUPERSEDED' } });
      const v = await tx.resultVersion.create({
        data: {
          tournamentId, version: (prev?.version ?? (await tx.resultVersion.count({ where: { tournamentId } }))) + 1,
          status: 'PROVISIONAL', notes: notes ?? null, publishedById: actor.type === 'ADMIN' ? actor.id : null,
          verifyCode: randomBytes(9).toString('base64url'),
        },
      });
      if (ranked.length) {
        await tx.resultEntry.createMany({
          data: ranked.map((r) => {
            const p = prizeFor(r.rank);
            const hasReward = !!p && (p.amountPaise > 0 || !!p.rewardEn);
            return {
              versionId: v.id, userId: r.userId, attemptId: r.attemptId, rank: r.rank, score: r.rawScore, adjustment: r.adjustment,
              adjustReason: r.adjustReason, accuracy: r.accuracy, timeTakenSec: r.timeTakenSec, submittedAt: r.submittedAt,
              percentile: r.percentile, disqualified: r.disqualified, dqReason: r.dqReason,
              rewardEn: hasReward ? p!.rewardEn ?? null : null, rewardHi: hasReward ? p!.rewardHi ?? null : null,
              rewardPaise: hasReward ? p!.amountPaise : 0, rewardStatus: hasReward ? 'ELIGIBLE' : 'NONE',
            };
          }),
        });
      }
      await this.audit.log(actor, {
        action: change ? 'results.correction' : 'results.generate', entityType: 'Tournament', entityId: tournamentId,
        meta: { version: v.version, entries: ranked.length, change, notes },
      }, tx);
      return v;
    });
    if (!prev) {
      await this.notifications.eventToTournament('RESULTS_PROVISIONAL', tournamentId, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}/results` });
    }
    return version;
  }

  async act(tournamentId: string, input: { userId: string; action: 'DISQUALIFY' | 'REINSTATE' | 'ADJUST'; amount?: number; reason: string }, actor: AuditActor) {
    const change =
      input.action === 'DISQUALIFY'
        ? { userId: input.userId, disqualified: true, dqReason: input.reason }
        : input.action === 'REINSTATE'
          ? { userId: input.userId, disqualified: false, dqReason: null }
          : { userId: input.userId, adjustment: input.amount ?? 0, adjustReason: input.reason };
    if (input.action === 'ADJUST' && input.amount === undefined) throw new BadRequestException('Adjustment amount is required');
    const v = await this.generate(tournamentId, actor, change, `${input.action}: ${input.reason}`);
    const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    if (input.action === 'REINSTATE') {
      await this.notifications.event('RESULT_REINSTATED', input.userId, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}/results` });
    } else if (input.action === 'ADJUST') {
      await this.notifications.event('RESULT_SCORE_ADJUSTED', input.userId, { tournament: { en: t.titleEn, hi: t.titleHi }, amount: `${(input.amount ?? 0) > 0 ? '+' : ''}${input.amount}`, reason: input.reason }, { link: `/tournament/${t.slug}/results` });
    }
    if (input.action === 'DISQUALIFY') {
      await this.notifications.event('RESULT_DISQUALIFIED', input.userId, { tournament: { en: t.titleEn, hi: t.titleHi }, reason: input.reason }, { link: `/tournament/${t.slug}/results` });
    }
    return v;
  }

  async finalize(tournamentId: string, actor: AuditActor) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status !== 'IN_REVIEW') throw new ConflictException('Only tournaments in review can be finalised');
    const v = await this.currentVersion(tournamentId);
    if (!v || v.status !== 'PROVISIONAL') throw new ConflictException('Generate provisional results first');
    const xpCfg = await this.config.get('gamification.xp');
    await this.prisma.$transaction(async (tx) => {
      await tx.resultVersion.update({ where: { id: v.id }, data: { status: 'FINAL', publishedAt: new Date(), publishedById: actor.id ?? null } });
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'FINAL', resultsFinalizedAt: new Date() } });
      for (const e of v.entries.filter((x) => x.rank != null && x.rank <= 10)) {
        await this.xp.award(e.userId, xpCfg.top10TournamentBonus, 'top10', tournamentId, tx);
      }
      await this.audit.log(actor, { action: 'results.finalize', entityType: 'Tournament', entityId: tournamentId, before: { status: 'IN_REVIEW' }, after: { status: 'FINAL', version: v.version } }, tx);
    });
    await this.notifications.eventToTournament('RESULTS_FINAL', tournamentId, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}/results` });
    return { ok: true, version: v.version };
  }

  /** Controlled reopening of final results. Blocked once any reward is paid. */
  async reopen(tournamentId: string, reason: string, actor: AuditActor) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t || t.status !== 'FINAL') throw new ConflictException('Only final results can be reopened');
    const v = await this.currentVersion(tournamentId);
    if (v?.entries.some((e) => e.rewardStatus === 'PAID' || e.rewardStatus === 'APPROVED')) {
      throw new ConflictException('Rewards have been approved or paid; reverse them before reopening');
    }
    await this.prisma.$transaction(async (tx) => {
      if (v) await tx.resultVersion.update({ where: { id: v.id }, data: { status: 'PROVISIONAL' } });
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'IN_REVIEW', resultsFinalizedAt: null } });
      await this.audit.log(actor, { action: 'results.reopen', entityType: 'Tournament', entityId: tournamentId, meta: { reason } }, tx);
    });
    return { ok: true };
  }

  async rewards(tournamentId: string, input: { userIds: string[]; action: 'APPROVE' | 'MARK_PAID' | 'WITHHOLD' | 'PAY_COINS'; payoutRef?: string; reason?: string }, actor: AuditActor) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t || !['FINAL', 'REWARDS_APPROVED'].includes(t.status)) throw new ConflictException('Rewards can be processed only after results are final');
    const v = await this.currentVersion(tournamentId);
    if (!v || v.status !== 'FINAL') throw new ConflictException('No final results');
    const targets = v.entries.filter((e) => input.userIds.includes(e.userId));
    const from = { APPROVE: ['ELIGIBLE'], MARK_PAID: ['APPROVED'], PAY_COINS: ['APPROVED'], WITHHOLD: ['ELIGIBLE', 'APPROVED'] }[input.action];
    const to = { APPROVE: 'APPROVED', MARK_PAID: 'PAID', PAY_COINS: 'PAID', WITHHOLD: 'WITHHELD' }[input.action] as ResultEntry['rewardStatus'];
    const ws = await this.wallet.settings();
    if (input.action === 'PAY_COINS' && (!ws.enabled || !ws.tournamentPrizesAsCoins)) throw new BadRequestException('Paying prizes as coins is turned off in Wallet settings');
    const coinsFor = (paise: number) => Math.floor(paise / ws.coinValuePaise);
    if (input.action === 'MARK_PAID' && !input.payoutRef) throw new BadRequestException('Payout reference is required');
    if (input.action === 'WITHHOLD' && !input.reason) throw new BadRequestException('Reason is required');
    const prizeSource = t.fundingSource === 'ENTRY_FEES' ? Account.PRIZE_POOL_LIABILITY : t.fundingSource === 'SPONSOR' ? Account.SPONSOR_FUNDS : Account.PLATFORM_PRIZE_EXPENSE;
    let changed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const e of targets) {
        if (!from.includes(e.rewardStatus) || e.disqualified) continue;
        await tx.resultEntry.update({ where: { id: e.id }, data: { rewardStatus: to, ...(input.payoutRef && { payoutRef: input.payoutRef }), ...(input.action === 'PAY_COINS' && { payoutRef: `coins:${coinsFor(e.rewardPaise)}` }) } });
        if (e.rewardPaise > 0) {
          if (input.action === 'APPROVE') {
            await this.ledger.post([{ account: prizeSource, debit: e.rewardPaise }, { account: Account.PRIZES_PAYABLE, credit: e.rewardPaise }], { memo: `prize approved rank ${e.rank}`, tournamentId }, tx);
          } else if (input.action === 'PAY_COINS') {
            // Prize value moves from prizes payable to the coin liability; any sub-coin remainder stays payable.
            const coins = coinsFor(e.rewardPaise);
            await this.wallet.earn(tx, e.userId, coins, 'EARN_PRIZE', { memo: `Prize rank ${e.rank}`, refType: 'ResultEntry', refId: e.id, idempotencyKey: `prize:${e.id}`, tournamentId, source: Account.PRIZES_PAYABLE });
          } else if (input.action === 'MARK_PAID') {
            await this.ledger.post([{ account: Account.PRIZES_PAYABLE, debit: e.rewardPaise }, { account: Account.PAYOUTS_BANK, credit: e.rewardPaise }], { memo: `prize paid ${input.payoutRef}`, tournamentId }, tx);
          } else if (e.rewardStatus === 'APPROVED') {
            await this.ledger.post([{ account: Account.PRIZES_PAYABLE, debit: e.rewardPaise }, { account: prizeSource, credit: e.rewardPaise }], { memo: `prize withheld rank ${e.rank}`, tournamentId }, tx);
          }
        }
        changed++;
      }
      await this.audit.log(actor, { action: `rewards.${input.action.toLowerCase()}`, entityType: 'Tournament', entityId: tournamentId, meta: { userIds: input.userIds, payoutRef: input.payoutRef, reason: input.reason, changed } }, tx);
    });
    for (const e of targets) {
      if (e.disqualified || !from.includes(e.rewardStatus)) continue;
      const reward = [e.rewardPaise ? formatRupees(e.rewardPaise) : null, e.rewardEn].filter(Boolean).join(' + ');
      const rewardHi = [e.rewardPaise ? formatRupees(e.rewardPaise) : null, e.rewardHi ?? e.rewardEn].filter(Boolean).join(' + ');
      const vars = { tournament: { en: t.titleEn, hi: t.titleHi }, reward: { en: reward, hi: rewardHi }, reference: input.payoutRef ?? '', reason: input.reason ?? '' };
      const key = input.action === 'APPROVE' ? 'REWARD_APPROVED' : input.action === 'MARK_PAID' || input.action === 'PAY_COINS' ? 'REWARD_PAID' : 'REWARD_WITHHELD';
      if (input.action === 'PAY_COINS') vars.reference = `${coinsFor(e.rewardPaise)} coins → wallet`;
      await this.notifications.event(key, e.userId, vars, { link: `/tournament/${t.slug}/results` });
    }
    return { changed };
  }

  // ------------------------------------------------------------- Read models

  private async liveRows(tournamentId: string) {
    const attempts = await this.prisma.attempt.findMany({ where: { tournamentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } });
    return rankEntries(
      attempts.map((a) => ({ userId: a.userId, attemptId: a.id, score: a.score ?? 0, accuracy: a.accuracy ?? 0, timeTakenSec: a.timeTakenSec ?? 0, submittedAt: a.submittedAt ?? a.deadlineAt, disqualified: false })),
    );
  }

  async forStudent(slug: string, userId: string): Promise<TournamentResultDto> {
    const t = await this.prisma.tournament.findUnique({ where: { slug } });
    if (!t || t.status === 'DRAFT') throw new NotFoundException('Tournament not found');
    const policy = await this.config.get('results.policy');
    const v = await this.currentVersion(t.id);
    const base = `${process.env.PUBLIC_BASE_URL ?? ''}`;

    let rows: (LeaderboardRowDto & { extra?: ResultEntry })[] = [];
    let resultStatus: TournamentResultDto['resultStatus'] = 'NONE';
    if (v) {
      resultStatus = v.status === 'FINAL' ? 'FINAL' : 'PROVISIONAL';
      const names = await this.names(v.entries.map((e) => e.userId));
      rows = v.entries
        .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
        .map((e) => ({
          rank: e.rank, userId: e.userId, displayName: names.get(e.userId) ?? 'Student', score: e.score + e.adjustment, accuracy: e.accuracy,
          timeTakenSec: e.timeTakenSec, disqualified: e.disqualified, isMe: e.userId === userId, extra: e,
        }));
    } else if (['LIVE', 'IN_REVIEW'].includes(t.status) && policy.showLiveLeaderboard) {
      resultStatus = 'LIVE';
      const live = await this.liveRows(t.id);
      const names = await this.names(live.map((e) => e.userId));
      rows = live.map((e) => ({
        rank: e.rank, userId: e.userId, displayName: names.get(e.userId) ?? 'Student', score: e.score, accuracy: e.accuracy,
        timeTakenSec: e.timeTakenSec, disqualified: false, isMe: e.userId === userId,
      }));
    }
    const meRow = rows.find((r) => r.isMe);
    const myAttempt = meRow ? null : await this.prisma.attempt.findFirst({ where: { tournamentId: t.id, userId } });
    const participants = rows.filter((r) => !r.disqualified).length;
    const percentileLive = meRow && resultStatus === 'LIVE' && meRow.rank && participants > 1 ? Math.round(((participants - meRow.rank) / (participants - 1)) * 10000) / 100 : null;
    return {
      tournamentId: t.id, slug: t.slug, titleEn: t.titleEn, titleHi: t.titleHi, status: t.status, resultStatus,
      version: v?.version ?? null, publishedAt: v?.publishedAt.toISOString() ?? null,
      verifyUrl: v?.status === 'FINAL' ? `${base}/verify/${v.verifyCode}` : null,
      appealDeadline: v && v.status === 'PROVISIONAL' ? new Date(v.publishedAt.getTime() + policy.appealWindowHours * 3_600_000).toISOString() : null,
      participants,
      leaderboard: rows.slice(0, policy.leaderboardSize).map(({ extra: _e, ...r }) => r),
      me: meRow
        ? {
            rank: meRow.rank, userId, displayName: meRow.displayName, score: meRow.score, accuracy: meRow.accuracy, timeTakenSec: meRow.timeTakenSec,
            disqualified: meRow.disqualified, isMe: true,
            percentile: meRow.extra?.percentile ?? percentileLive,
            rewardEn: meRow.extra?.rewardEn ?? null, rewardHi: meRow.extra?.rewardHi ?? null, rewardPaise: meRow.extra?.rewardPaise ?? 0,
            rewardStatus: meRow.extra?.rewardStatus ?? 'NONE', dqReason: meRow.extra?.dqReason ?? null,
            attemptId: meRow.extra?.attemptId ?? (await this.prisma.attempt.findFirst({ where: { tournamentId: t.id, userId } }))!.id,
          }
        : myAttempt && myAttempt.status !== 'IN_PROGRESS'
          ? {
              rank: null, userId, displayName: '', score: myAttempt.score ?? 0, accuracy: myAttempt.accuracy ?? 0, timeTakenSec: myAttempt.timeTakenSec ?? 0,
              disqualified: false, isMe: true, percentile: null, rewardEn: null, rewardHi: null, rewardPaise: 0, rewardStatus: 'NONE', dqReason: null, attemptId: myAttempt.id,
            }
          : null,
    };
  }

  async forAdmin(tournamentId: string) {
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!t) throw new NotFoundException('Tournament not found');
    const versions = await this.prisma.resultVersion.findMany({ where: { tournamentId }, orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, notes: true, publishedAt: true, publishedById: true, verifyCode: true } });
    const v = await this.currentVersion(tournamentId);
    const userIds = v ? v.entries.map((e) => e.userId) : [];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const attemptIds = v ? v.entries.map((e) => e.attemptId) : [];
    const events = await this.prisma.attemptEvent.groupBy({ by: ['attemptId', 'type'], where: { attemptId: { in: attemptIds } }, _count: true, _sum: { riskPoints: true } });
    const flags = new Map<string, Record<string, number>>();
    for (const e of events) {
      const current = flags.get(e.attemptId) ?? {};
      current[e.type] = e._count;
      current.RISK_POINTS = (current.RISK_POINTS ?? 0) + (e._sum.riskPoints ?? 0);
      flags.set(e.attemptId, current);
    }
    const [live, submitted, registered, activeAttempts] = await Promise.all([
      this.prisma.attempt.count({ where: { tournamentId, status: 'IN_PROGRESS' } }),
      this.prisma.attempt.count({ where: { tournamentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } }),
      this.prisma.registration.count({ where: { tournamentId, status: 'CONFIRMED' } }),
      this.prisma.attempt.findMany({ where: { tournamentId, status: 'IN_PROGRESS' }, orderBy: { startedAt: 'asc' }, take: 1000, select: { id: true, startedAt: true, user: { select: { displayName: true, email: true } } } }),
    ]);
    return {
      tournament: { id: t.id, titleEn: t.titleEn, status: t.status, slug: t.slug, fundingSource: t.fundingSource },
      counts: { registered, inProgress: live, submitted },
      activeAttempts,
      current: v ? { id: v.id, version: v.version, status: v.status, verifyCode: v.verifyCode, publishedAt: v.publishedAt } : null,
      versions,
      entries: (v?.entries ?? [])
        .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
        .map((e) => ({ ...e, user: byId.get(e.userId) ?? null, integrity: flags.get(e.attemptId) ?? {} })),
    };
  }

  async proctorEvents(tournamentId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, tournamentId },
      select: {
        id: true, status: true, startedAt: true, submittedAt: true,
        user: { select: { displayName: true, email: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found in this tournament');
    const events = await this.prisma.attemptEvent.findMany({
      where: { attemptId }, orderBy: { at: 'desc' }, take: 500,
      select: { id: true, type: true, meta: true, at: true, clientAt: true, platform: true, appVersion: true, osVersion: true, deviceModel: true, riskPoints: true },
    });
    return { attempt, events };
  }

  async warnDuringAttempt(tournamentId: string, attemptId: string, reason: string, actor: AuditActor) {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, tournamentId, status: 'IN_PROGRESS' },
      select: { id: true, userId: true, user: { select: { displayName: true } }, tournament: { select: { titleEn: true } } },
    });
    if (!attempt) throw new NotFoundException('Active attempt not found in this tournament');
    await this.prisma.attemptEvent.create({
      data: { attemptId, type: 'ADMIN_WARNING', meta: { reason, adminId: actor.id ?? 'unknown' }, riskPoints: 0 },
    });
    await this.audit.log(actor, { action: 'proctor.warning', entityType: 'Attempt', entityId: attemptId, after: { reason } });
    const notification = await this.notifications.event('PROCTOR_WARNING', attempt.userId, { tournament: attempt.tournament?.titleEn ?? 'your exam', reason }, { link: `/exam/${attemptId}` });
    return { warningRecorded: true, notificationQueued: Boolean(notification) };
  }

  /** Public verification page data for a final (or provisional) result version. */
  async verify(code: string) {
    const v = await this.prisma.resultVersion.findUnique({ where: { verifyCode: code }, include: { tournament: true, entries: { where: { rank: { not: null } }, orderBy: { rank: 'asc' }, take: 100 } } });
    if (!v) throw new NotFoundException('Result not found');
    const names = await this.names(v.entries.map((e) => e.userId));
    return {
      tournament: v.tournament.titleEn,
      version: v.version,
      status: v.status,
      publishedAt: v.publishedAt,
      entries: v.entries.map((e) => ({ rank: e.rank, name: names.get(e.userId) ?? 'Student', score: e.score + e.adjustment, accuracy: e.accuracy, reward: e.rewardEn })),
    };
  }

  /** Home leaderboard by XP. */
  async globalLeaderboard(userId: string, size: number) {
    const top = await this.prisma.user.findMany({ where: { status: 'ACTIVE', deletedAt: null, xp: { gt: 0 } }, orderBy: [{ xp: 'desc' }, { createdAt: 'asc' }], take: size, select: { id: true, displayName: true, dateOfBirth: true, audience: true, avatarUrl: true, xp: true } });
    const policy = await this.config.get('results.policy');
    const age = await this.config.get('policy.age');
    return top.map((u, i) => ({
      rank: i + 1, userId: u.id, displayName: publicName(u.displayName, isMinor(u, age.adultAge), policy.hideMinorNames), avatarUrl: u.avatarUrl, points: u.xp, isMe: u.id === userId,
    }));
  }
}

export type { Prisma };
