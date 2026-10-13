import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AdminUser, Prisma } from '@prisma/client';
import {
  adminCreateSchema,
  adminLoginSchema,
  Permission,
  refreshSchema,
  ROLE_PERMISSIONS,
  userStatusSchema,
  type LoginInput,
} from '@testwise/shared';
import * as bcrypt from 'bcrypt';
import { parsePaging } from '../common/pagination';
import { RedisService } from '../common/redis.service';
import type { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentAdmin, RequirePermission } from '../common/auth.guards';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../common/tokens.service';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';

const publicAdmin = (a: AdminUser) => ({
  id: a.id,
  email: a.email,
  name: a.name,
  role: a.role,
  active: a.active,
  lastLoginAt: a.lastLoginAt,
  createdAt: a.createdAt,
  permissions: ROLE_PERMISSIONS[a.role],
});

const paging = (page?: string, pageSize?: string) => parsePaging(page, pageSize);

/**
 * Temporary admin auth (email + password). MFA will be enforced when
 * Firebase Identity Platform is connected.
 */
const DUMMY_ADMIN_HASH = bcrypt.hash('timing-equaliser', 12);

@Controller('v1/admin/auth')
export class AdminAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body(new ZodPipe(adminLoginSchema)) body: LoginInput) {
    const failKey = `admin-login-fail:${body.email}`;
    if ((await this.redis.counter(failKey)) >= 5) {
      throw new HttpException('Too many failed sign-in attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { email: body.email } });
    // One bcrypt compare either way, so an unknown address takes as long as a wrong password.
    const passwordOk = await bcrypt.compare(body.password, admin?.passwordHash ?? (await DUMMY_ADMIN_HASH));
    if (!admin || !admin.active || !passwordOk) {
      await this.redis.incr(failKey, 15 * 60);
      await this.audit.log({ type: 'SYSTEM' }, { action: 'admin.login_failed', entityType: 'AdminUser', meta: { email: body.email } });
      throw new UnauthorizedException('Incorrect email or password');
    }
    await this.redis.resetCounter(failKey);
    const updated = await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ type: 'ADMIN', id: admin.id }, { action: 'admin.login', entityType: 'AdminUser', entityId: admin.id });
    return { ...(await this.tokens.issue('ADMIN', admin.id, admin.role)), admin: publicAdmin(updated) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    const { subjectId } = await this.tokens.rotate('ADMIN', body.refreshToken);
    const admin = await this.prisma.adminUser.findUnique({ where: { id: subjectId } });
    if (!admin?.active) throw new UnauthorizedException('Admin account disabled');
    return { ...(await this.tokens.issue('ADMIN', admin.id, admin.role)), admin: publicAdmin(admin) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    await this.tokens.revoke(body.refreshToken);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: AdminUser) {
    return publicAdmin(admin);
  }
}

@Controller('v1/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----- Dashboard

  @Get('dashboard')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  async dashboard() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [users, newUsers, onboarded, questionsByStatus, tournamentsByStatus, registrations, banners] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { onboardedAt: { not: null } } }),
      this.prisma.question.groupBy({ by: ['status'], _count: true }),
      this.prisma.tournament.groupBy({ by: ['status'], _count: true }),
      this.prisma.registration.count({ where: { status: 'CONFIRMED' } }),
      this.prisma.banner.count({ where: { active: true } }),
    ]);
    const upcoming = await this.prisma.tournament.findMany({
      where: { status: { in: ['SCHEDULED', 'REG_OPEN', 'REG_CLOSED', 'LIVE'] } },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: { id: true, titleEn: true, status: true, startsAt: true, maxParticipants: true, _count: { select: { registrations: true } } },
    });
    const [revenue, pendingRefunds, openTickets, liveAttempts, ordersToday] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ where: { account: 'PLATFORM_REVENUE' }, _sum: { creditPaise: true, debitPaise: true } }),
      this.prisma.refund.count({ where: { status: { in: ['REQUESTED', 'APPROVED'] } } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.attempt.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.order.count({ where: { status: 'PAID', paidAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    return {
      finance: { netRevenuePaise: (revenue._sum.creditPaise ?? 0) - (revenue._sum.debitPaise ?? 0), pendingRefunds, ordersLast24h: ordersToday },
      support: { openTickets },
      liveAttempts,
      users: { total: users, newLast7Days: newUsers, onboarded },
      questions: Object.fromEntries(questionsByStatus.map((q) => [q.status, q._count])),
      tournaments: Object.fromEntries(tournamentsByStatus.map((t) => [t.status, t._count])),
      confirmedRegistrations: registrations,
      activeBanners: banners,
      upcoming,
    };
  }

  // ----- Admin users

  @Get('admins')
  @RequirePermission(Permission.ADMINS_MANAGE)
  async listAdmins() {
    const admins = await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return admins.map(publicAdmin);
  }

  @Post('admins')
  @RequirePermission(Permission.ADMINS_MANAGE)
  async createAdmin(@Body(new ZodPipe(adminCreateSchema)) body: z.infer<typeof adminCreateSchema>, @AdminActor() actor: AuditActor) {
    if (await this.prisma.adminUser.findUnique({ where: { email: body.email } })) {
      throw new ConflictException('An admin with this email already exists');
    }
    const admin = await this.prisma.adminUser.create({
      data: { email: body.email, name: body.name, role: body.role, passwordHash: await bcrypt.hash(body.password, 12) },
    });
    await this.audit.log(actor, { action: 'admin.create', entityType: 'AdminUser', entityId: admin.id, after: publicAdmin(admin) });
    return publicAdmin(admin);
  }

  @Patch('admins/:id')
  @RequirePermission(Permission.ADMINS_MANAGE)
  async updateAdmin(
    @Param('id') id: string,
    @Body() body: { active?: boolean; role?: AdminUser['role'] },
    @CurrentAdmin() me: AdminUser,
    @AdminActor() actor: AuditActor,
  ) {
    if (id === me.id) throw new ForbiddenException('You cannot change your own role or status');
    const before = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    const data: Prisma.AdminUserUpdateInput = {};
    if (typeof body.active === 'boolean') data.active = body.active;
    if (body.role) {
      if (!(body.role in ROLE_PERMISSIONS)) throw new BadRequestException('Unknown role');
      data.role = body.role;
    }
    const after = await this.prisma.adminUser.update({ where: { id }, data });
    if (data.active === false) await this.tokens.revokeAll('ADMIN', id);
    await this.audit.log(actor, { action: 'admin.update', entityType: 'AdminUser', entityId: id, before: publicAdmin(before), after: publicAdmin(after) });
    return publicAdmin(after);
  }

  // ----- Students

  @Get('users')
  @RequirePermission(Permission.USERS_READ)
  async listUsers(@Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const pg = paging(page, pageSize);
    const where: Prisma.UserWhereInput = q
      ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }, { id: q }] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.take,
        select: {
          id: true, email: true, displayName: true, audience: true, classLevel: true, language: true,
          status: true, authProvider: true, onboardedAt: true, createdAt: true, streakDays: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: pg.page, pageSize: pg.pageSize };
  }

  @Get('users/:id')
  @RequirePermission(Permission.USERS_READ)
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { exams: { include: { exam: true } }, registrations: { include: { tournament: { select: { titleEn: true, slug: true } } } } },
    });
    if (!user) throw new NotFoundException();
    const { passwordHash: _ph, ...safe } = user;
    const [audit, attempts, orders, enrollments, tickets] = await Promise.all([
      this.prisma.auditEvent.findMany({ where: { entityType: 'User', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.attempt.findMany({
        where: { userId: id }, orderBy: { startedAt: 'desc' }, take: 30,
        select: { id: true, status: true, score: true, maxScore: true, accuracy: true, startedAt: true, submittedAt: true, test: { select: { titleEn: true } }, tournament: { select: { titleEn: true } }, _count: { select: { events: true } } },
      }),
      this.prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, receiptNo: true, descriptionEn: true, amountPaise: true, status: true, createdAt: true } }),
      this.prisma.enrollment.findMany({ where: { userId: id }, include: { series: { select: { titleEn: true } } } }),
      this.prisma.supportTicket.findMany({ where: { userId: id }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, subject: true, category: true, status: true } }),
    ]);
    return { ...safe, audit, attempts, orders, enrollments, tickets };
  }

  @Patch('users/:id/status')
  @RequirePermission(Permission.USERS_WRITE)
  async setUserStatus(
    @Param('id') id: string,
    @Body(new ZodPipe(userStatusSchema)) body: z.infer<typeof userStatusSchema>,
    @AdminActor() actor: AuditActor,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw new NotFoundException();
    const after = await this.prisma.user.update({ where: { id }, data: { status: body.status }, select: { id: true, status: true } });
    if (body.status === 'SUSPENDED') await this.tokens.revokeAll('USER', id);
    await this.notifications.event(body.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REINSTATED', id, { reason: body.reason });
    await this.audit.log(actor, { action: `user.${body.status.toLowerCase()}`, entityType: 'User', entityId: id, before, after, meta: { reason: body.reason } });
    return after;
  }

  // ----- Audit log

  @Get('audit')
  @RequirePermission(Permission.AUDIT_READ)
  async auditLog(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pg = paging(page, pageSize);
    const where: Prisma.AuditEventWhereInput = {
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      ...(actorId && { actorId }),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take }),
      this.prisma.auditEvent.count({ where }),
    ]);
    const adminIds = [...new Set(items.filter((i) => i.actorType === 'ADMIN' && i.actorId).map((i) => i.actorId!))];
    const admins = await this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } });
    const byId = new Map(admins.map((a) => [a.id, a]));
    return {
      items: items.map((i) => ({ ...i, actor: i.actorId ? byId.get(i.actorId) ?? null : null })),
      total,
      page: pg.page,
      pageSize: pg.pageSize,
    };
  }
}
