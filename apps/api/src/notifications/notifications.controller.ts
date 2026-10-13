import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  campaignSchema,
  deviceSchema,
  NOTIFICATION_EVENTS,
  notificationPrefsSchema,
  Permission,
  templateUpdateSchema,
  type CampaignInput,
  type NotificationEventKey,
} from '@testwise/shared';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentUser, RequirePermission, UserAuthGuard } from '../common/auth.guards';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { CampaignsService } from './campaigns.service';
import { NotificationsService } from './notifications.service';
import { PushWorker } from './push.worker';

const openSchema = z.object({ batchId: z.string().min(1).max(100) });
const unregisterSchema = z.object({ token: z.string().min(10).max(4096) });
const testSchema = z.object({ userRef: z.string().trim().min(3), titleEn: z.string().trim().min(1).max(120).default('Test notification'), bodyEn: z.string().trim().min(1).max(500).default('Push notifications are working 🎉') });

@Controller('v1/me')
@UseGuards(UserAuthGuard)
export class MeNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('devices')
  @HttpCode(200)
  register(@CurrentUser() u: User, @Body(new ZodPipe(deviceSchema)) body: z.infer<typeof deviceSchema>) {
    return this.notifications.registerDevice(u.id, body);
  }

  @Post('devices/unregister')
  @HttpCode(200)
  unregister(@CurrentUser() u: User, @Body(new ZodPipe(unregisterSchema)) body: { token: string }) {
    return this.notifications.unregisterDevice(u.id, body.token);
  }

  @Get('notification-settings')
  prefs(@CurrentUser() u: User) {
    return this.notifications.preferences(u.id);
  }

  @Put('notification-settings')
  setPrefs(@CurrentUser() u: User, @Body(new ZodPipe(notificationPrefsSchema)) body: { categories: Record<string, boolean> }) {
    return this.notifications.setPreferences(u.id, body.categories);
  }

  @Post('notifications/opened')
  @HttpCode(200)
  opened(@CurrentUser() u: User, @Body(new ZodPipe(openSchema)) body: { batchId: string }) {
    return this.notifications.markOpened(u.id, body.batchId);
  }
}

@Controller('v1/admin/notifications')
@UseGuards(AdminAuthGuard)
export class AdminNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly campaigns: CampaignsService,
    private readonly worker: PushWorker,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  @RequirePermission(Permission.SUPPORT_READ)
  async status() {
    const [devices, pending, failedJobs, last24] = await Promise.all([
      this.prisma.pushDevice.groupBy({ by: ['platform', 'provider'], where: { active: true }, _count: true }),
      this.prisma.pushOutbox.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.prisma.pushOutbox.count({ where: { status: 'FAILED' } }),
      this.prisma.pushDelivery.groupBy({ by: ['status'], where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: true }),
    ]);
    return {
      providers: this.worker.status(),
      devices: devices.map((d) => ({ platform: d.platform, provider: d.provider, count: d._count })),
      queue: { pending, failedJobs },
      last24h: Object.fromEntries(last24.map((r) => [r.status, r._count])),
    };
  }

  // ----- Templates
  @Get('templates')
  @RequirePermission(Permission.SUPPORT_READ)
  async templates() {
    const rows = await this.prisma.notificationTemplate.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[]).map((key) => {
      const def = NOTIFICATION_EVENTS[key];
      const t = byKey.get(key);
      return {
        key, category: def.category, descriptionEn: def.descriptionEn, vars: def.vars,
        titleEn: t?.titleEn ?? def.titleEn, titleHi: t?.titleHi ?? def.titleHi, bodyEn: t?.bodyEn ?? def.bodyEn, bodyHi: t?.bodyHi ?? def.bodyHi,
        push: t?.push ?? def.push, inbox: t?.inbox ?? def.inbox, enabled: t?.enabled ?? true, customised: !!t, updatedAt: t?.updatedAt ?? null,
      };
    });
  }

  @Put('templates/:key')
  @RequirePermission(Permission.NOTIFY)
  async updateTemplate(@Param('key') key: string, @Body(new ZodPipe(templateUpdateSchema)) body: z.infer<typeof templateUpdateSchema>, @AdminActor() actor: AuditActor) {
    if (!(key in NOTIFICATION_EVENTS)) throw new NotFoundException('Unknown notification event');
    const before = await this.prisma.notificationTemplate.findUnique({ where: { key } });
    const t = await this.prisma.notificationTemplate.upsert({ where: { key }, create: { key, ...body, updatedById: actor.id }, update: { ...body, updatedById: actor.id } });
    this.notifications.invalidateTemplates();
    await this.audit.log(actor, { action: 'notification.template_update', entityType: 'NotificationTemplate', entityId: key, before, after: t });
    return t;
  }

  @Delete('templates/:key')
  @RequirePermission(Permission.NOTIFY)
  async resetTemplate(@Param('key') key: string, @AdminActor() actor: AuditActor) {
    await this.prisma.notificationTemplate.deleteMany({ where: { key } });
    this.notifications.invalidateTemplates();
    await this.audit.log(actor, { action: 'notification.template_reset', entityType: 'NotificationTemplate', entityId: key });
    return { ok: true };
  }

  // ----- Campaigns (custom notifications)
  @Get('campaigns')
  @RequirePermission(Permission.SUPPORT_READ)
  list() {
    return this.campaigns.list();
  }

  @Post('campaigns/preview')
  @HttpCode(200)
  @RequirePermission(Permission.NOTIFY)
  preview(@Body(new ZodPipe(campaignSchema)) body: CampaignInput) {
    return this.campaigns.preview(body);
  }

  @Post('campaigns')
  @RequirePermission(Permission.NOTIFY)
  create(@Body(new ZodPipe(campaignSchema)) body: CampaignInput, @AdminActor() actor: AuditActor) {
    return this.campaigns.create(body, actor);
  }

  @Post('campaigns/:id/cancel')
  @RequirePermission(Permission.NOTIFY)
  cancel(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.campaigns.cancel(id, actor);
  }

  /** Send a one-off test push to a student's devices to verify Firebase / APNs setup. */
  @Post('test')
  @RequirePermission(Permission.NOTIFY)
  async test(@Body(new ZodPipe(testSchema)) body: z.infer<typeof testSchema>, @AdminActor() actor: AuditActor) {
    const { userIds, notFound } = await this.campaigns.resolveUsers([body.userRef]);
    if (!userIds.length) throw new NotFoundException(`No student found for ${notFound[0]}`);
    const devices = await this.prisma.pushDevice.count({ where: { userId: userIds[0], active: true } });
    const r = await this.notifications.writeForUsers(userIds, { titleEn: body.titleEn, titleHi: null, bodyEn: body.bodyEn, bodyHi: null }, { category: 'ACCOUNT', eventKey: 'TEST', push: true, inbox: false });
    await this.audit.log(actor, { action: 'notification.test', entityType: 'User', entityId: userIds[0] });
    return { batchId: r.batchId, devices };
  }

  // ----- Delivery log
  @Get('deliveries')
  @RequirePermission(Permission.SUPPORT_READ)
  async deliveries(@Query('status') status?: string, @Query('userRef') userRef?: string) {
    let userId: string | undefined;
    if (userRef) userId = (await this.campaigns.resolveUsers([userRef])).userIds[0] ?? '__none__';
    const rows = await this.prisma.pushDelivery.findMany({
      where: { ...(status && { status: status as never }), ...(userId && { userId }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { outbox: { select: { notification: { select: { titleEn: true, eventKey: true, category: true } } } }, device: { select: { platform: true } } },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, email: true, displayName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id, status: r.status, error: r.error, provider: r.provider, platform: r.device?.platform ?? null, createdAt: r.createdAt,
      title: r.outbox.notification.titleEn, eventKey: r.outbox.notification.eventKey, category: r.outbox.notification.category, user: byId.get(r.userId) ?? null,
    }));
  }

  @Get('jobs')
  @RequirePermission(Permission.SUPPORT_READ)
  jobs() {
    return this.prisma.pushOutbox.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, audience: true, status: true, sent: true, failed: true, skipped: true, attempts: true, error: true, createdAt: true, finishedAt: true, nextAttemptAt: true, notification: { select: { titleEn: true, eventKey: true, category: true } } },
    });
  }
}
