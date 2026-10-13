import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Tournament, type TournamentStatus } from '@prisma/client';
import {
  PUBLIC_TOURNAMENT_STATUSES,
  TOURNAMENT_TRANSITIONS,
  prizePoolFromTiers,
  winnerCountFromTiers,
  type Eligibility,
  type PrizeTier,
  type TournamentCardDto,
  type TournamentDetailDto,
  type TournamentInput,
} from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { AttemptsService } from '../attempts/attempts.service';
import { AuditService, type AuditActor } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ResultsService } from '../results/results.service';
import { RegistrationsService } from './registrations.service';

const cardInclude = {
  exam: { select: { id: true, slug: true, nameEn: true, nameHi: true } },
  _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } },
} satisfies Prisma.TournamentInclude;

type CardRow = Prisma.TournamentGetPayload<{ include: typeof cardInclude }>;

/** Fields whose change after publication must be disclosed in the public rule-change history. */
const MATERIAL_FIELDS: (keyof TournamentInput)[] = [
  'testId',
  'rulesEn', 'scoringEn', 'refundPolicyEn', 'entryMode', 'entryFeePaise', 'platformFeePercent', 'rewardType',
  'fundingSource', 'prizeTiers', 'maxParticipants', 'minParticipants', 'registrationOpensAt',
  'registrationClosesAt', 'startsAt', 'endsAt', 'durationMinutes', 'questionCount', 'eligibility', 'proctorMode', 'proctorOptions',
];

const EDITABLE_AFTER_PUBLISH: TournamentStatus[] = ['SCHEDULED', 'REG_OPEN', 'REG_CLOSED'];

export const LIVE_GROUP: TournamentStatus[] = ['LIVE'];
export const UPCOMING_GROUP: TournamentStatus[] = ['SCHEDULED', 'REG_OPEN', 'REG_CLOSED'];
export const PAST_GROUP: TournamentStatus[] = ['IN_REVIEW', 'FINAL', 'REWARDS_APPROVED', 'CLOSED', 'CANCELLED'];

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toISOString();
  return v ?? null;
}

export function toCard(t: CardRow): TournamentCardDto {
  const tiers = (t.prizeTiers as unknown as PrizeTier[]) ?? [];
  const top = [...tiers].sort((a, b) => a.fromRank - b.fromRank)[0];
  return {
    id: t.id,
    slug: t.slug,
    titleEn: t.titleEn,
    titleHi: t.titleHi,
    status: t.status,
    format: t.format,
    entryMode: t.entryMode,
    entryFeePaise: t.entryFeePaise,
    rewardType: t.rewardType,
    prizePoolPaise: t.prizePoolPaise,
    topRewardEn: top?.rewardEn ?? null,
    topRewardHi: top?.rewardHi ?? null,
    maxParticipants: t.maxParticipants,
    participantCount: t._count.registrations,
    registrationOpensAt: t.registrationOpensAt.toISOString(),
    registrationClosesAt: t.registrationClosesAt.toISOString(),
    startsAt: t.startsAt.toISOString(),
    endsAt: t.endsAt.toISOString(),
    durationMinutes: t.durationMinutes,
    questionCount: t.questionCount,
    bannerColor: t.bannerColor,
    bannerImageUrl: t.bannerImageUrl,
    featured: t.featured,
    proctorMode: t.proctorMode,
    proctorOptions: (t.proctorOptions as Record<string, boolean>) ?? {},
    exam: t.exam,
  };
}

@Injectable()
export class TournamentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TournamentsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly attempts: AttemptsService,
    private readonly registrations: RegistrationsService,
    private readonly results: ResultsService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const run = () => void this.redis.withLock('job:tournament-lifecycle', 120_000, () => this.autoAdvance()).catch((e) => this.logger.error(e));
    this.timer = setInterval(run, 15_000);
    run();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Time-based lifecycle, run every 15 seconds:
   * open/close registration, go live (or cancel below the minimum), close the window and start review.
   */
  async autoAdvance() {
    const now = new Date();
    const system: AuditActor = { type: 'SYSTEM' };
    const due = await this.prisma.tournament.findMany({
      where: {
        OR: [
          { status: 'SCHEDULED', registrationOpensAt: { lte: now } },
          { status: 'REG_OPEN', registrationClosesAt: { lte: now } },
          { status: 'REG_CLOSED', startsAt: { lte: now } },
          { status: 'LIVE', endsAt: { lte: now } },
        ],
      },
    });
    for (const t of due) {
      try {
        if (t.status === 'SCHEDULED') {
          await this.move(t.id, 'SCHEDULED', t.registrationClosesAt > now ? 'REG_OPEN' : 'REG_CLOSED', system);
        } else if (t.status === 'REG_OPEN') {
          await this.move(t.id, 'REG_OPEN', 'REG_CLOSED', system);
        } else if (t.status === 'REG_CLOSED') {
          const confirmed = await this.prisma.registration.count({ where: { tournamentId: t.id, status: 'CONFIRMED' } });
          if (confirmed < t.minParticipants) {
            await this.cancel(t.id, `Minimum of ${t.minParticipants} participants not reached`, system);
          } else if (!t.testId) {
            this.logger.warn(`Tournament ${t.slug} reached start time without a test attached`);
          } else {
            await this.move(t.id, 'REG_CLOSED', 'LIVE', system);
          }
        } else if (t.status === 'LIVE') {
          const { gracePeriodSeconds } = await this.config.get('exam.integrity');
          if (now.getTime() >= t.endsAt.getTime() + gracePeriodSeconds * 1000) await this.endLive(t.id, system);
        }
      } catch (e) {
        this.logger.error(`autoAdvance ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  private async move(id: string, from: TournamentStatus, to: TournamentStatus, actor: AuditActor, meta?: Record<string, unknown>) {
    const moved = await this.prisma.$transaction(async (tx) => {
      const res = await tx.tournament.updateMany({ where: { id, status: from }, data: { status: to } });
      if (res.count) await this.audit.log(actor, { action: actor.type === 'SYSTEM' ? 'tournament.auto_transition' : 'tournament.transition', entityType: 'Tournament', entityId: id, before: { status: from }, after: { status: to }, meta }, tx);
      return res.count > 0;
    });
    if (moved && to === 'LIVE') {
      const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id } });
      await this.notifications.eventToTournament('TOURNAMENT_LIVE', id, { tournament: { en: t.titleEn, hi: t.titleHi } }, { link: `/tournament/${t.slug}` });
    }
    return moved;
  }

  /** Close the test window: submit open attempts, move to review and publish provisional results if enabled. */
  private async endLive(id: string, actor: AuditActor) {
    await this.attempts.closeTournament(id);
    if (await this.move(id, 'LIVE', 'IN_REVIEW', actor)) {
      const { autoPublishProvisional } = await this.config.get('results.policy');
      if (autoPublishProvisional) await this.results.generate(id, { type: 'SYSTEM' });
    }
  }

  private async cancel(id: string, reason: string, actor: AuditActor) {
    const t = await this.prisma.tournament.findUniqueOrThrow({ where: { id } });
    const res = await this.prisma.tournament.updateMany({ where: { id, status: t.status }, data: { status: 'CANCELLED', cancelledReason: reason } });
    if (!res.count) return;
    await this.audit.log(actor, { action: 'tournament.cancel', entityType: 'Tournament', entityId: id, before: { status: t.status }, after: { status: 'CANCELLED' }, meta: { reason } });
    await this.attempts.closeTournament(id);
    await this.notifications.eventToTournament('TOURNAMENT_CANCELLED', id, { tournament: { en: t.titleEn, hi: t.titleHi }, reason }, { link: `/tournament/${t.slug}` });
    await this.registrations.cancelAll(id, reason);
  }

  // ------------------------------------------------------------- Student-facing

  async listPublic(params: { group?: string; examId?: string; entryMode?: string; featured?: boolean; take?: number }) {
    const statuses =
      params.group === 'live' ? LIVE_GROUP : params.group === 'upcoming' ? UPCOMING_GROUP : params.group === 'past' ? PAST_GROUP : PUBLIC_TOURNAMENT_STATUSES;
    const rows = await this.prisma.tournament.findMany({
      where: {
        status: { in: statuses },
        ...(params.examId && { examId: params.examId }),
        ...(params.entryMode === 'FREE' || params.entryMode === 'PAID' ? { entryMode: params.entryMode } : {}),
        ...(params.featured && { featured: true }),
      },
      include: cardInclude,
      orderBy: params.group === 'past' ? { startsAt: 'desc' } : [{ featured: 'desc' }, { startsAt: 'asc' }],
      take: Math.min(params.take ?? 50, 100),
    });
    return rows.map(toCard);
  }

  async detailPublic(slug: string): Promise<TournamentDetailDto> {
    const t = await this.prisma.tournament.findUnique({
      where: { slug },
      include: { ...cardInclude, ruleChanges: { orderBy: { createdAt: 'desc' } } },
    });
    if (!t || t.status === 'DRAFT') throw new NotFoundException('Tournament not found');
    const tiers = (t.prizeTiers as unknown as PrizeTier[]) ?? [];
    return {
      ...toCard(t),
      descriptionEn: t.descriptionEn,
      descriptionHi: t.descriptionHi,
      rulesEn: t.rulesEn,
      rulesHi: t.rulesHi,
      scoringEn: t.scoringEn,
      scoringHi: t.scoringHi,
      refundPolicyEn: t.refundPolicyEn,
      refundPolicyHi: t.refundPolicyHi,
      fundingSource: t.fundingSource,
      sponsorName: t.sponsorName,
      platformFeePercent: t.platformFeePercent,
      prizeTiers: [...tiers].sort((a, b) => a.fromRank - b.fromRank),
      minParticipants: t.minParticipants,
      eligibility: t.eligibility as unknown as Eligibility,
      winnerCount: winnerCountFromTiers(tiers),
      ruleChanges: t.ruleChanges.map((r) => ({ id: r.id, summaryEn: r.summaryEn, summaryHi: r.summaryHi, createdAt: r.createdAt.toISOString() })),
      publishedAt: t.publishedAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------- Admin

  async listAdmin(params: { status?: TournamentStatus; q?: string }) {
    const rows = await this.prisma.tournament.findMany({
      where: {
        ...(params.status && { status: params.status }),
        ...(params.q && { OR: [{ titleEn: { contains: params.q, mode: 'insensitive' } }, { slug: { contains: params.q } }] }),
      },
      include: cardInclude,
      orderBy: { startsAt: 'desc' },
      take: 200,
    });
    return rows.map(toCard);
  }

  async getAdmin(id: string) {
    const t = await this.prisma.tournament.findUnique({
      where: { id },
      include: { ...cardInclude, ruleChanges: { orderBy: { createdAt: 'desc' } } },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    return { ...t, participantCount: t._count.registrations };
  }

  /** Global money policy; tournaments cannot be published beyond it. */
  private async policyViolations(t: Pick<Tournament, 'entryMode' | 'rewardType' | 'fundingSource'> & { prizeTiers: unknown }) {
    const policy = await this.config.get('policy.money');
    const tiers = (t.prizeTiers as PrizeTier[]) ?? [];
    const v: string[] = [];
    if (t.entryMode === 'PAID' && !policy.paidEntryEnabled) v.push('Paid entry is disabled in Settings → Money model');
    if (!policy.cashRewardsEnabled && (t.rewardType === 'CASH' || tiers.some((x) => x.amountPaise > 0))) {
      v.push('Cash rewards are disabled in Settings → Money model');
    }
    if (t.fundingSource === 'ENTRY_FEES' && !policy.entryFundedPrizesEnabled) {
      v.push('Entry-fee-funded prizes are disabled in Settings → Money model');
    }
    return v;
  }

  private async assertTest(testId: string | null | undefined) {
    if (!testId) return;
    const test = await this.prisma.test.findUnique({ where: { id: testId } });
    if (!test) throw new BadRequestException('Selected test does not exist');
    if (test.status !== 'PUBLISHED') throw new BadRequestException('Attach a published test');
  }

  private data(input: TournamentInput) {
    return {
      ...input,
      registrationOpensAt: new Date(input.registrationOpensAt),
      registrationClosesAt: new Date(input.registrationClosesAt),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      examId: input.examId || null,
      subjectId: input.subjectId || null,
      testId: input.testId || null,
      prizeTiers: input.prizeTiers as unknown as Prisma.InputJsonValue,
      eligibility: input.eligibility as unknown as Prisma.InputJsonValue,
      proctorOptions: input.proctorOptions as Prisma.InputJsonValue,
      prizePoolPaise: prizePoolFromTiers(input.prizeTiers),
    };
  }

  private conflict(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Slug already in use');
    throw e;
  }

  async create(input: TournamentInput, actor: AuditActor) {
    await this.assertTest(input.testId);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.tournament.create({ data: { ...this.data(input), createdById: actor.id } }).catch((e) => this.conflict(e));
      await this.audit.log(actor, { action: 'tournament.create', entityType: 'Tournament', entityId: t.id, after: t }, tx);
      return t;
    });
  }

  async duplicate(id: string, actor: AuditActor) {
    const src = await this.prisma.tournament.findUnique({ where: { id } });
    if (!src) throw new NotFoundException('Tournament not found');
    const {
      id: _id, slug, status: _s, publishedAt: _p, cancelledReason: _c, createdAt: _ca, updatedAt: _u, createdById: _cb, ...rest
    } = src;
    const copy = await this.prisma.tournament.create({
      data: {
        ...rest,
        prizeTiers: src.prizeTiers as Prisma.InputJsonValue,
        eligibility: src.eligibility as Prisma.InputJsonValue,
        proctorOptions: src.proctorOptions as Prisma.InputJsonValue,
        slug: `${slug}-copy-${Date.now().toString(36)}`,
        titleEn: `${src.titleEn} (copy)`,
        featured: false,
        status: 'DRAFT',
        createdById: actor.id,
      },
    });
    await this.audit.log(actor, { action: 'tournament.duplicate', entityType: 'Tournament', entityId: copy.id, meta: { sourceId: id } });
    return copy;
  }

  async update(id: string, input: TournamentInput, change: { summaryEn?: string; summaryHi?: string | null }, actor: AuditActor) {
    await this.assertTest(input.testId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tournament.findUnique({ where: { id }, include: { _count: { select: { registrations: { where: { status: 'CONFIRMED' } } } } } });
      if (!before) throw new NotFoundException('Tournament not found');
      const published = before.status !== 'DRAFT';
      if (published && !EDITABLE_AFTER_PUBLISH.includes(before.status)) {
        throw new ConflictException(`A ${before.status} tournament can no longer be edited`);
      }
      const changed = MATERIAL_FIELDS.filter(
        (f) => JSON.stringify(normalise((before as Record<string, unknown>)[f])) !== JSON.stringify(normalise(input[f])),
      );
      if (published) {
        if (before.slug !== input.slug) throw new ConflictException('Slug cannot change after publishing (links are already shared)');
        if (before._count.registrations > 0 && (before.entryFeePaise !== input.entryFeePaise || before.entryMode !== input.entryMode)) {
          throw new ConflictException('Entry fee cannot change once students have registered; cancel and refund instead');
        }
        if (changed.length && !change.summaryEn) {
          throw new BadRequestException({
            message: 'This tournament is public. Describe the change for the public rule-change history.',
            changedFields: changed,
          });
        }
        const violations = await this.policyViolations(input);
        if (violations.length) throw new BadRequestException({ message: 'Blocked by money policy', issues: violations });
      }
      const after = await tx.tournament.update({ where: { id }, data: this.data(input) }).catch((e) => this.conflict(e));
      if (published && changed.length) {
        await tx.tournamentRuleChange.create({
          data: { tournamentId: id, summaryEn: change.summaryEn!, summaryHi: change.summaryHi ?? null, changedById: actor.id },
        });
      }
      await this.audit.log(actor, { action: 'tournament.update', entityType: 'Tournament', entityId: id, before, after, meta: { changedFields: changed } }, tx);
      if (published && changed.length) {
        await this.notifications.eventToTournament('TOURNAMENT_RULES_CHANGED', id, { tournament: { en: after.titleEn, hi: after.titleHi }, summary: { en: change.summaryEn!, hi: change.summaryHi } }, { link: `/tournament/${after.slug}`, tx });
      }
      return after;
    });
  }

  async transition(id: string, to: TournamentStatus, reason: string | undefined, actor: AuditActor) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (!TOURNAMENT_TRANSITIONS[t.status].includes(to)) {
      throw new ConflictException(`Cannot move from ${t.status} to ${to}`);
    }
    if (to === 'CANCELLED' && !reason) throw new BadRequestException('A reason is required to cancel');
    if (to === 'DRAFT') {
      const regs = await this.prisma.registration.count({ where: { tournamentId: id } });
      if (regs) throw new ConflictException('Cannot unpublish: students have already registered');
    }
    if (t.status === 'DRAFT' && to === 'SCHEDULED') {
      const violations = await this.policyViolations(t);
      if (violations.length) throw new BadRequestException({ message: 'Blocked by money policy', issues: violations });
    }
    if (to === 'LIVE' && !t.testId) throw new ConflictException('Attach a published test before going live');
    if (to === 'CANCELLED') {
      await this.cancel(id, reason!, actor);
      return this.prisma.tournament.findUnique({ where: { id } });
    }
    if (to === 'IN_REVIEW') {
      await this.endLive(id, actor);
      return this.prisma.tournament.findUnique({ where: { id } });
    }
    if (to === 'FINAL') {
      await this.results.finalize(id, actor);
      return this.prisma.tournament.findUnique({ where: { id } });
    }
    if (to === 'REWARDS_APPROVED') {
      const v = await this.prisma.resultVersion.findFirst({ where: { tournamentId: id, status: 'FINAL' }, include: { entries: true } });
      if (v?.entries.some((e) => e.rewardStatus === 'ELIGIBLE' && !e.disqualified)) throw new ConflictException('Approve or withhold every eligible reward first');
    }
    if (to === 'LIVE') {
      await this.move(id, t.status, 'LIVE', actor, reason ? { reason } : undefined);
      return this.prisma.tournament.findUnique({ where: { id } });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.tournament.update({
        where: { id },
        data: {
          status: to,
          ...(to === 'SCHEDULED' && !t.publishedAt && { publishedAt: new Date() }),
        },
      });
      await this.audit.log(actor, { action: 'tournament.transition', entityType: 'Tournament', entityId: id, before: { status: t.status }, after: { status: to }, meta: reason ? { reason } : undefined }, tx);
      return u;
    });
    if (to === 'SCHEDULED') await this.autoAdvance();
    return this.prisma.tournament.findUnique({ where: { id: updated.id } });
  }

  async remove(id: string, actor: AuditActor) {
    const t = await this.prisma.tournament.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.status !== 'DRAFT') throw new ConflictException('Only drafts can be deleted; cancel published tournaments instead');
    await this.prisma.$transaction(async (tx) => {
      await tx.tournament.delete({ where: { id } });
      await this.audit.log(actor, { action: 'tournament.delete', entityType: 'Tournament', entityId: id, before: t }, tx);
    });
    return { ok: true };
  }
}
