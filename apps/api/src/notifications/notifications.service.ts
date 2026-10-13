import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CATEGORY_INFO,
  NOTIFICATION_EVENTS,
  renderTemplate,
  type NotificationCategory,
  type NotificationDto,
  type NotificationEventKey,
  type TemplateVar,
} from '@testwise/shared';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface Rendered {
  titleEn: string;
  titleHi: string | null;
  bodyEn: string;
  bodyHi: string | null;
}

export interface SendOptions {
  link?: string | null;
  data?: Record<string, unknown>;
  tx?: Tx;
}

interface Template extends Rendered {
  category: NotificationCategory;
  push: boolean;
  inbox: boolean;
  enabled: boolean;
}

/**
 * Single entry point for every notification: renders the admin-editable template
 * in English and Hindi, writes the in-app inbox row and queues push delivery.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private cache: { at: number; map: Map<string, Template> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidateTemplates() {
    this.cache = null;
  }

  async template(key: NotificationEventKey): Promise<Template> {
    if (!this.cache || Date.now() - this.cache.at > 30_000) {
      const rows = await this.prisma.notificationTemplate.findMany();
      this.cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, { ...r, category: NOTIFICATION_EVENTS[r.key as NotificationEventKey]?.category ?? 'ACCOUNT' }])) };
    }
    const def = NOTIFICATION_EVENTS[key];
    return this.cache.map.get(key) ?? { ...def, enabled: true };
  }

  private render(t: Template, vars: Record<string, TemplateVar>): Rendered {
    return {
      titleEn: renderTemplate(t.titleEn, vars, 'EN'),
      titleHi: t.titleHi ? renderTemplate(t.titleHi, vars, 'HI') : null,
      bodyEn: renderTemplate(t.bodyEn, vars, 'EN'),
      bodyHi: t.bodyHi ? renderTemplate(t.bodyHi, vars, 'HI') : null,
    };
  }

  /** Notify one student about an event. */
  async event(key: NotificationEventKey, userId: string, vars: Record<string, TemplateVar>, opts: SendOptions = {}) {
    return this.eventToUsers(key, [userId], vars, opts);
  }

  /** Notify a list of students (each gets their own inbox row; one push job for the batch). */
  async eventToUsers(key: NotificationEventKey, userIds: string[], vars: Record<string, TemplateVar>, opts: SendOptions = {}) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return null;
    const t = await this.template(key);
    if (!t.enabled || (!t.push && !t.inbox)) return null;
    return this.writeForUsers(ids, this.render(t, vars), { category: t.category, eventKey: key, push: t.push, inbox: t.inbox, link: opts.link, data: opts.data }, opts.tx);
  }

  /** Notify everyone registered for a tournament (one shared inbox row). */
  async eventToTournament(key: NotificationEventKey, tournamentId: string, vars: Record<string, TemplateVar>, opts: SendOptions = {}) {
    const t = await this.template(key);
    if (!t.enabled || (!t.push && !t.inbox)) return null;
    const tx = opts.tx ?? this.prisma;
    const batchId = randomUUID();
    const n = await tx.notification.create({
      data: { tournamentId, category: t.category, eventKey: key, inbox: t.inbox, batchId, link: opts.link ?? null, data: (opts.data ?? undefined) as Prisma.InputJsonValue | undefined, ...this.render(t, vars) },
    });
    if (t.push) await tx.pushOutbox.create({ data: { id: batchId, notificationId: n.id, audience: 'TOURNAMENT', tournamentId, nextAttemptAt: this.deliverAt(t.category) } });
    return n;
  }

  /** Low-level writer used by events and admin campaigns. */
  async writeForUsers(
    userIds: string[],
    content: Rendered,
    meta: { category: string; eventKey?: string | null; push: boolean; inbox: boolean; link?: string | null; data?: Record<string, unknown>; campaignId?: string | null },
    tx: Tx = this.prisma,
  ) {
    const batchId = randomUUID();
    const rows = userIds.map((userId) => ({
      id: randomUUID(),
      userId,
      category: meta.category,
      eventKey: meta.eventKey ?? null,
      campaignId: meta.campaignId ?? null,
      inbox: meta.inbox,
      batchId,
      link: meta.link ?? null,
      data: (meta.data ?? undefined) as Prisma.InputJsonValue | undefined,
      ...content,
    }));
    for (let i = 0; i < rows.length; i += 1000) await tx.notification.createMany({ data: rows.slice(i, i + 1000) });
    if (meta.push) {
      await tx.pushOutbox.create({
        data: {
          id: batchId,
          notificationId: rows[0].id,
          audience: userIds.length === 1 ? 'USER' : 'USERS',
          userId: userIds.length === 1 ? userIds[0] : null,
          userIds: userIds.length === 1 ? [] : userIds,
          nextAttemptAt: this.deliverAt(meta.category as NotificationCategory),
        },
      });
    }
    return { batchId, count: rows.length };
  }

  /** Broadcast to every student (one shared inbox row). */
  async writeBroadcast(content: Rendered, meta: { category: string; push: boolean; inbox: boolean; link?: string | null; campaignId?: string | null; createdById?: string | null }) {
    const batchId = randomUUID();
    const n = await this.prisma.notification.create({
      data: { category: meta.category, inbox: meta.inbox, batchId, link: meta.link ?? null, campaignId: meta.campaignId ?? null, createdById: meta.createdById ?? null, ...content },
    });
    if (meta.push) await this.prisma.pushOutbox.create({ data: { id: batchId, notificationId: n.id, audience: 'ALL', nextAttemptAt: this.deliverAt(meta.category as NotificationCategory) } });
    return { batchId, notificationId: n.id };
  }

  /** Promotional pushes wait until quiet hours end (IST); everything else goes now. */
  private deliverAt(category: NotificationCategory): Date {
    if (category !== 'PROMOTIONS') return new Date();
    const quiet = this.quietHours;
    const istHour = new Date(Date.now() + 330 * 60_000).getUTCHours();
    const inQuiet = quiet.start > quiet.end ? istHour >= quiet.start || istHour < quiet.end : istHour >= quiet.start && istHour < quiet.end;
    if (!inQuiet) return new Date();
    const ist = new Date(Date.now() + 330 * 60_000);
    const target = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), quiet.end, 0, 0));
    if (istHour >= quiet.end) target.setUTCDate(target.getUTCDate() + 1);
    return new Date(target.getTime() - 330 * 60_000);
  }

  /** Set by the scheduler from Settings → Notification timing. */
  quietHours = { start: 22, end: 7 };

  // ------------------------------------------------------------- Inbox

  private async visibleWhere(userId: string): Promise<Prisma.NotificationWhereInput> {
    // Include cancelled registrations so students still see why a tournament they joined was cancelled or refunded.
    const regs = await this.prisma.registration.findMany({ where: { userId }, select: { tournamentId: true } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } });
    return {
      inbox: true,
      OR: [
        { userId },
        { userId: null, tournamentId: null, createdAt: { gte: new Date(user.createdAt.getTime() - 7 * 86_400_000) } },
        { userId: null, tournamentId: { in: regs.map((r) => r.tournamentId) } },
      ],
    };
  }

  async inbox(userId: string, category?: string): Promise<NotificationDto[]> {
    const where = await this.visibleWhere(userId);
    const rows = await this.prisma.notification.findMany({
      where: category ? { AND: [where, { category }] } : where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { reads: { where: { userId }, select: { userId: true } } },
    });
    return rows.map((r) => ({
      id: r.id, titleEn: r.titleEn, titleHi: r.titleHi, bodyEn: r.bodyEn, bodyHi: r.bodyHi, link: r.link,
      createdAt: r.createdAt.toISOString(), read: r.reads.length > 0, category: r.category,
    }));
  }

  async unreadCount(userId: string) {
    const where = await this.visibleWhere(userId);
    return this.prisma.notification.count({ where: { AND: [where, { reads: { none: { userId } } }] } });
  }

  async markAllRead(userId: string) {
    const rows = await this.prisma.notification.findMany({ where: { AND: [await this.visibleWhere(userId), { reads: { none: { userId } } }] }, select: { id: true } });
    if (rows.length) await this.prisma.notificationRead.createMany({ data: rows.map((r) => ({ notificationId: r.id, userId })), skipDuplicates: true });
    return { marked: rows.length };
  }

  /** Record that a student opened a push (tap). */
  async markOpened(userId: string, batchId: string) {
    const rows = await this.prisma.notification.findMany({ where: { batchId, OR: [{ userId }, { userId: null }] }, select: { id: true } });
    for (const r of rows) {
      await this.prisma.notificationRead.upsert({
        where: { notificationId_userId: { notificationId: r.id, userId } },
        create: { notificationId: r.id, userId, openedAt: new Date() },
        update: { openedAt: new Date() },
      });
    }
    return { opened: rows.length };
  }

  // ------------------------------------------------------------- Preferences & devices

  async preferences(userId: string) {
    const rows = await this.prisma.notificationSetting.findMany({ where: { userId } });
    const map = new Map(rows.map((r) => [r.category, r.push]));
    return (Object.keys(CATEGORY_INFO) as NotificationCategory[]).map((c) => ({ category: c, ...CATEGORY_INFO[c], push: CATEGORY_INFO[c].mutable ? map.get(c) ?? true : true }));
  }

  async setPreferences(userId: string, categories: Record<string, boolean>) {
    for (const [category, push] of Object.entries(categories)) {
      const info = CATEGORY_INFO[category as NotificationCategory];
      if (!info || !info.mutable) continue;
      await this.prisma.notificationSetting.upsert({ where: { userId_category: { userId, category } }, create: { userId, category, push }, update: { push } });
    }
    return this.preferences(userId);
  }

  async registerDevice(userId: string, d: { token: string; provider: 'FCM' | 'APNS'; platform: string; appVersion?: string | null; locale?: string | null }) {
    // A token belongs to one device; re-assign it if another account used this phone before.
    return this.prisma.pushDevice.upsert({
      where: { token: d.token },
      create: { userId, token: d.token, provider: d.provider, platform: d.platform, appVersion: d.appVersion ?? null, locale: d.locale ?? null },
      update: { userId, provider: d.provider, platform: d.platform, appVersion: d.appVersion ?? null, locale: d.locale ?? null, active: true, lastSeenAt: new Date() },
      select: { id: true, provider: true, platform: true, active: true },
    });
  }

  async unregisterDevice(userId: string, token: string) {
    await this.prisma.pushDevice.updateMany({ where: { token, userId }, data: { active: false } });
    return { ok: true };
  }
}
