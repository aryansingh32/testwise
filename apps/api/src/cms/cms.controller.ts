import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { Banner, User } from '@prisma/client';
import {
  bannerSchema,
  homeSectionUpdateSchema,
  Permission,
  type BannerDto,
  type BannerInput,
  type HomeDto,
  type HomeSectionKey,
} from '@testwise/shared';
import type { z } from 'zod';
import { AppConfigService } from '../app-config/app-config.service';
import { AdminActor, AdminAuthGuard, CurrentUser, RequirePermission, UserAuthGuard } from '../common/auth.guards';
import { AuditService, type AuditActor } from '../common/audit.service';
import { TtlCache } from '../common/ttl-cache';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { MissionsService } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { ResultsService } from '../results/results.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import type { ContinueItemDto } from '@testwise/shared';

const toBannerDto = (b: Banner): BannerDto => ({
  id: b.id, tagEn: b.tagEn, tagHi: b.tagHi, titleEn: b.titleEn, titleHi: b.titleHi,
  subtitleEn: b.subtitleEn, subtitleHi: b.subtitleHi, ctaEn: b.ctaEn, ctaHi: b.ctaHi,
  color: b.color, imageUrl: b.imageUrl, linkType: b.linkType, linkTarget: b.linkTarget,
});

const bannerData = (b: BannerInput) => ({
  ...b,
  startsAt: b.startsAt ? new Date(b.startsAt) : null,
  endsAt: b.endsAt ? new Date(b.endsAt) : null,
});

@Controller('v1/home')
@UseGuards(UserAuthGuard)
export class HomeController {
  /** Content every student sees the same way: a few seconds of staleness is fine and it removes ~10 queries from each Home load. */
  private readonly shared = new TtlCache(8_000, 200);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentsService,
    private readonly config: AppConfigService,
    private readonly missions: MissionsService,
    private readonly notifications: NotificationsService,
    private readonly results: ResultsService,
  ) {}

  /** In-progress tests first, then enrolled series with completion progress. */
  private async continueLearning(userId: string): Promise<ContinueItemDto[]> {
    const now = new Date();
    const [open, enrollments] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { userId, status: 'IN_PROGRESS', deadlineAt: { gt: now } },
        include: { test: { select: { titleEn: true, titleHi: true } }, tournament: { select: { titleEn: true, titleHi: true, bannerColor: true } }, _count: { select: { answers: true } } },
        orderBy: { startedAt: 'desc' },
        take: 3,
      }),
      this.prisma.enrollment.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: now }, series: { status: 'PUBLISHED' } },
        include: { series: { include: { tests: { where: { test: { status: 'PUBLISHED' } }, select: { testId: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    const items: ContinueItemDto[] = open.map((a) => ({
      kind: 'ATTEMPT', id: a.id, titleEn: a.tournament?.titleEn ?? a.test.titleEn, titleHi: a.tournament?.titleHi ?? a.test.titleHi,
      color: a.tournament?.bannerColor ?? '#3B82F6', progress: a._count.answers, total: (a.paper as { questions: unknown[] }).questions.length,
      attemptId: a.id, seriesSlug: null,
    }));
    // One query for every enrolled series instead of one per series.
    const allTestIds = [...new Set(enrollments.flatMap((e) => e.series.tests.map((t) => t.testId)))];
    const doneIds = new Set(
      allTestIds.length
        ? (await this.prisma.attempt.groupBy({ by: ['testId'], where: { userId, testId: { in: allTestIds }, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } })).map((d) => d.testId)
        : [],
    );
    for (const e of enrollments) {
      const testIds = e.series.tests.map((t) => t.testId);
      items.push({
        kind: 'SERIES', id: e.series.id, titleEn: e.series.titleEn, titleHi: e.series.titleHi, color: e.series.color,
        progress: testIds.filter((id) => doneIds.has(id)).length, total: testIds.length, attemptId: null, seriesSlug: e.series.slug,
      });
    }
    return items;
  }

  /** Everything the Home screen renders, in the order and with the sections admin configured. */
  @Get()
  async home(@CurrentUser() user: User): Promise<HomeDto> {
    const now = new Date();
    const [banners, sections, exams, userExams, flags] = await Promise.all([
      this.shared.get('banners', () => this.prisma.banner.findMany({
        where: {
          active: true,
          AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
        },
        orderBy: { sortOrder: 'asc' },
      })),
      this.shared.get('sections', () => this.prisma.homeSection.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } })),
      this.shared.get(`exams:${user.audience ?? 'ALL'}`, () => this.prisma.exam.findMany({
        where: { active: true, ...(user.audience === 'SCHOOL' ? { category: 'SCHOOL' } : user.audience === 'EXAM' ? { category: 'COMPETITIVE' } : {}) },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, slug: true, nameEn: true, nameHi: true, category: true, icon: true, color: true },
      })),
      this.prisma.userExam.findMany({ where: { userId: user.id }, select: { examId: true } }),
      this.config.get('features.flags'),
    ]);

    // Independent reads run concurrently; they were awaited one after another (8+ sequential round trips per Home load).
    const [live, upcoming, leaderboard, continueLearning, missions, unreadNotifications] = await Promise.all([
      flags.tournaments ? this.shared.get('t:live', () => this.tournaments.listPublic({ group: 'live', take: 10 })) : [],
      flags.tournaments ? this.shared.get('t:upcoming', () => this.tournaments.listPublic({ group: 'upcoming', take: 20 })) : [],
      flags.leaderboards
        ? this.config.get('gamification.xp').then(async (xp) => {
            // Same top-N for everyone; only `isMe` differs, so cache it with no user and mark the caller afterwards.
            const board = await this.shared.get(`lb:${xp.homeLeaderboardSize}`, () => this.results.globalLeaderboard('', xp.homeLeaderboardSize));
            return board.map((r) => ({ ...r, isMe: r.userId === user.id }));
          })
        : [],
      this.continueLearning(user.id),
      this.missions.forUser(user.id),
      this.notifications.unreadCount(user.id),
    ]);
    let tournaments = [...live, ...upcoming];
    // Prefer the student's exams, but keep exam-agnostic events.
    const mine = new Set(userExams.map((e) => e.examId));
    if (mine.size) {
      tournaments = [...tournaments.filter((t) => !t.exam || mine.has(t.exam.id)), ...tournaments.filter((t) => t.exam && !mine.has(t.exam.id))];
    }

    const hidden = new Set<HomeSectionKey>([
      ...(!flags.tournaments ? (['LIVE_TOURNAMENTS'] as const) : []),
      ...(!flags.dailyMissions ? (['DAILY_MISSIONS'] as const) : []),
      ...(!flags.leaderboards ? (['LEADERBOARD'] as const) : []),
    ]);

    return {
      banners: banners.map(toBannerDto),
      sections: sections
        .filter((s) => !hidden.has(s.key as HomeSectionKey))
        .map((s) => ({ key: s.key as HomeSectionKey, titleEn: s.titleEn, titleHi: s.titleHi })),
      tournaments: tournaments.slice(0, 10),
      exams,
      leaderboard,
      continueLearning,
      missions,
      unreadNotifications,
      // Read after missions: completing one awards XP during this request.
      xp: (await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { xp: true } })).xp,
    };
  }
}

@Controller('v1/admin/cms')
@UseGuards(AdminAuthGuard)
export class AdminCmsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('banners')
  @RequirePermission(Permission.TOURNAMENT_READ)
  banners() {
    return this.prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Post('banners')
  @RequirePermission(Permission.CMS_WRITE)
  async createBanner(@Body(new ZodPipe(bannerSchema)) body: BannerInput, @AdminActor() actor: AuditActor) {
    const b = await this.prisma.banner.create({ data: bannerData(body) });
    await this.audit.log(actor, { action: 'banner.create', entityType: 'Banner', entityId: b.id, after: b });
    return b;
  }

  @Put('banners/:id')
  @RequirePermission(Permission.CMS_WRITE)
  async updateBanner(@Param('id') id: string, @Body(new ZodPipe(bannerSchema)) body: BannerInput, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.banner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const b = await this.prisma.banner.update({ where: { id }, data: bannerData(body) });
    await this.audit.log(actor, { action: 'banner.update', entityType: 'Banner', entityId: id, before, after: b });
    return b;
  }

  @Delete('banners/:id')
  @RequirePermission(Permission.CMS_WRITE)
  async deleteBanner(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.banner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    await this.prisma.banner.delete({ where: { id } });
    await this.audit.log(actor, { action: 'banner.delete', entityType: 'Banner', entityId: id, before });
    return { ok: true };
  }

  @Get('sections')
  @RequirePermission(Permission.TOURNAMENT_READ)
  sections() {
    return this.prisma.homeSection.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Put('sections')
  @RequirePermission(Permission.CMS_WRITE)
  async updateSections(@Body(new ZodPipe(homeSectionUpdateSchema)) body: z.infer<typeof homeSectionUpdateSchema>, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.homeSection.findMany({ orderBy: { sortOrder: 'asc' } });
    await this.prisma.$transaction(
      body.sections.map((s) =>
        this.prisma.homeSection.upsert({ where: { key: s.key }, create: s, update: s }),
      ),
    );
    const after = await this.prisma.homeSection.findMany({ orderBy: { sortOrder: 'asc' } });
    await this.audit.log(actor, { action: 'home_sections.update', entityType: 'HomeSection', before, after });
    return after;
  }
}
