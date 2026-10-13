import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SeriesStatus } from '@prisma/client';
import type { CheckoutDto, SeriesCardDto, SeriesDetailDto, SeriesInput } from '@testwise/shared';
import { AttemptsService } from '../attempts/attempts.service';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';

const cardInclude = {
  exam: { select: { nameEn: true, nameHi: true } },
  tests: { where: { test: { status: 'PUBLISHED' } }, select: { testId: true } },
} satisfies Prisma.TestSeriesInclude;

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly attempts: AttemptsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private activeEnrollment(userId: string) {
    return { where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } } as const;
  }

  private toCard(s: Prisma.TestSeriesGetPayload<{ include: typeof cardInclude }>, enrolled: boolean): SeriesCardDto {
    return {
      id: s.id, slug: s.slug, titleEn: s.titleEn, titleHi: s.titleHi,
      examName: s.exam ? { en: s.exam.nameEn, hi: s.exam.nameHi } : null,
      pricePaise: s.pricePaise, mrpPaise: s.mrpPaise, color: s.color, imageUrl: s.imageUrl, badgeEn: s.badgeEn, badgeHi: s.badgeHi,
      testCount: s.tests.length, enrolled, featured: s.featured,
    };
  }

  async list(userId: string, examId?: string, q?: string) {
    const rows = await this.prisma.testSeries.findMany({
      where: {
        status: 'PUBLISHED',
        ...(examId && { examId }),
        ...(q && { OR: [{ titleEn: { contains: q, mode: 'insensitive' } }, { titleHi: { contains: q, mode: 'insensitive' } }] }),
      },
      include: { ...cardInclude, enrollments: this.activeEnrollment(userId) },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((s) => this.toCard(s, s.enrollments.length > 0));
  }

  async mine(userId: string) {
    const rows = await this.prisma.testSeries.findMany({
      where: { enrollments: { some: this.activeEnrollment(userId).where } },
      include: { ...cardInclude, enrollments: this.activeEnrollment(userId) },
    });
    return rows.map((s) => this.toCard(s, true));
  }

  async detail(userId: string, slug: string): Promise<SeriesDetailDto> {
    const s = await this.prisma.testSeries.findUnique({
      where: { slug },
      include: { ...cardInclude, enrollments: this.activeEnrollment(userId), tests: { orderBy: { sortOrder: 'asc' }, where: { test: { status: 'PUBLISHED' } } } },
    });
    if (!s || s.status !== 'PUBLISHED') throw new NotFoundException('Test series not found');
    const enrolled = s.enrollments.length > 0 || s.pricePaise === 0;
    const enrolledCount = await this.prisma.enrollment.count({ where: { seriesId: s.id, revokedAt: null } });
    return {
      ...this.toCard(s, s.enrollments.length > 0),
      descriptionEn: s.descriptionEn,
      descriptionHi: s.descriptionHi,
      validityDays: s.validityDays,
      features: (s.features as { en: string; hi?: string | null }[]) ?? [],
      enrolledUntil: s.enrollments[0]?.expiresAt.toISOString() ?? null,
      enrolledCount,
      tests: await this.attempts.testCards(userId, s.tests.map((t) => ({ testId: t.testId, freePreview: t.freePreview })), enrolled),
    };
  }

  async purchase(userId: string, slug: string, input: { couponCode?: string | null; idempotencyKey: string }): Promise<{ enrolled: boolean; checkout: CheckoutDto | null }> {
    const s = await this.prisma.testSeries.findUnique({ where: { slug } });
    if (!s || s.status !== 'PUBLISHED') throw new NotFoundException('Test series not found');
    const active = await this.prisma.enrollment.findFirst({ where: { userId, seriesId: s.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (active) return { enrolled: true, checkout: null };

    if (s.pricePaise === 0) {
      await this.prisma.enrollment.upsert({
        where: { userId_seriesId: { userId, seriesId: s.id } },
        create: { userId, seriesId: s.id, source: 'FREE', expiresAt: new Date(Date.now() + s.validityDays * 86_400_000) },
        update: { source: 'FREE', revokedAt: null, expiresAt: new Date(Date.now() + s.validityDays * 86_400_000) },
      });
      return { enrolled: true, checkout: null };
    }
    const order = await this.payments.singleFlight(input.idempotencyKey, () =>
      this.prisma.$transaction(async (tx) => {
        const o = await this.payments.createOrder(
          { userId, kind: 'SERIES_PURCHASE', refId: s.id, descriptionEn: `Test series: ${s.titleEn}`, amountPaise: s.pricePaise, couponCode: input.couponCode, idempotencyKey: input.idempotencyKey },
          tx,
        );
        if (o.status === 'PAID') await this.payments.fulfill(o.id, tx);
        return o;
      }),
    );
    return { enrolled: order.status === 'PAID', checkout: await this.payments.checkout(order) };
  }

  async quote(slug: string, couponCode: string) {
    const s = await this.prisma.testSeries.findUnique({ where: { slug } });
    if (!s) throw new NotFoundException('Test series not found');
    const { discountPaise } = await this.payments.quoteCoupon(couponCode, 'SERIES_PURCHASE', s.pricePaise);
    return { pricePaise: s.pricePaise, discountPaise, payablePaise: s.pricePaise - discountPaise };
  }

  // ------------------------------------------------------------- Admin

  adminList() {
    return this.prisma.testSeries.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { exam: { select: { nameEn: true } }, _count: { select: { tests: true, enrollments: true } } },
    });
  }

  async adminGet(id: string) {
    const s = await this.prisma.testSeries.findUnique({
      where: { id },
      include: { tests: { orderBy: { sortOrder: 'asc' }, include: { test: { select: { id: true, titleEn: true, status: true, kind: true, durationMinutes: true } } } }, _count: { select: { enrollments: true } } },
    });
    if (!s) throw new NotFoundException('Series not found');
    return s;
  }

  private data(input: SeriesInput) {
    const { tests: _t, ...rest } = input;
    return { ...rest, examId: rest.examId || null, features: rest.features as unknown as Prisma.InputJsonValue };
  }

  private async writeTests(tx: Prisma.TransactionClient, seriesId: string, input: SeriesInput) {
    const ids = input.tests.map((t) => t.testId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A test is listed twice');
    if ((await tx.test.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException('Unknown test in list');
    await tx.seriesTest.deleteMany({ where: { seriesId } });
    if (ids.length) await tx.seriesTest.createMany({ data: input.tests.map((t, i) => ({ seriesId, testId: t.testId, freePreview: t.freePreview, sortOrder: i })) });
  }

  private conflict(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Slug already in use');
    throw e;
  }

  async create(input: SeriesInput, actor: AuditActor) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.testSeries.create({ data: this.data(input) }).catch((e) => this.conflict(e));
      await this.writeTests(tx, s.id, input);
      await this.audit.log(actor, { action: 'series.create', entityType: 'TestSeries', entityId: s.id, after: input }, tx);
      return s;
    });
  }

  async update(id: string, input: SeriesInput, actor: AuditActor) {
    const before = await this.adminGet(id);
    if (before.status === 'PUBLISHED' && before.slug !== input.slug) throw new ConflictException('Slug cannot change after publishing');
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.testSeries.update({ where: { id }, data: this.data(input) }).catch((e) => this.conflict(e));
      await this.writeTests(tx, id, input);
      await this.audit.log(actor, { action: 'series.update', entityType: 'TestSeries', entityId: id, before, after: input }, tx);
      return s;
    });
  }

  async setStatus(id: string, status: SeriesStatus, actor: AuditActor) {
    const s = await this.adminGet(id);
    if (status === 'PUBLISHED' && !s.tests.some((t) => t.test.status === 'PUBLISHED')) throw new BadRequestException('Add at least one published test first');
    const updated = await this.prisma.testSeries.update({ where: { id }, data: { status } });
    await this.audit.log(actor, { action: `series.${status.toLowerCase()}`, entityType: 'TestSeries', entityId: id, before: { status: s.status }, after: { status } });
    return updated;
  }

  async grant(id: string, email: string, days: number, actor: AuditActor) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new NotFoundException('No student with that email');
    const e = await this.prisma.enrollment.upsert({
      where: { userId_seriesId: { userId: user.id, seriesId: id } },
      create: { userId: user.id, seriesId: id, source: 'ADMIN_GRANT', expiresAt: new Date(Date.now() + days * 86_400_000) },
      update: { source: 'ADMIN_GRANT', revokedAt: null, expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    await this.audit.log(actor, { action: 'series.grant', entityType: 'TestSeries', entityId: id, meta: { userId: user.id, days } });
    const s = await this.prisma.testSeries.findUniqueOrThrow({ where: { id } });
    await this.notifications.event('ACCESS_GRANTED', user.id, { series: { en: s.titleEn, hi: s.titleHi }, days }, { link: `/series/${s.slug}` });
    return e;
  }
}
