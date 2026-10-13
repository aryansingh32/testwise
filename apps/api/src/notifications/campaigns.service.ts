import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CampaignInput } from '@testwise/shared';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from './notifications.service';

/** Admin-composed notifications: per student, bulk lists, tournaments, exams, segments or everyone. */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Resolve emails / ids to student ids, reporting the ones not found. */
  async resolveUsers(refs: string[]) {
    const clean = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
    const emails = clean.filter((r) => r.includes('@')).map((r) => r.toLowerCase());
    const ids = clean.filter((r) => !r.includes('@'));
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, OR: [{ email: { in: emails } }, { id: { in: ids } }] },
      select: { id: true, email: true },
    });
    const foundEmails = new Set(users.map((u) => u.email));
    const foundIds = new Set(users.map((u) => u.id));
    return { userIds: users.map((u) => u.id), notFound: [...emails.filter((e) => !foundEmails.has(e)), ...ids.filter((i) => !foundIds.has(i))] };
  }

  private async audienceUserIds(c: { audience: string; filter: Prisma.JsonValue }): Promise<string[] | 'ALL'> {
    const f = (c.filter ?? {}) as { userIds?: string[]; tournamentId?: string; examId?: string; segment?: { audience?: 'SCHOOL' | 'EXAM' | null; classLevels?: number[]; inactiveDays?: number | null } };
    if (c.audience === 'ALL') return 'ALL';
    if (c.audience === 'USERS') return f.userIds ?? [];
    if (c.audience === 'TOURNAMENT') {
      const regs = await this.prisma.registration.findMany({ where: { tournamentId: f.tournamentId, status: { not: 'CANCELLED' } }, select: { userId: true } });
      return regs.map((r) => r.userId);
    }
    if (c.audience === 'EXAM') {
      const rows = await this.prisma.userExam.findMany({ where: { examId: f.examId, user: { deletedAt: null, status: 'ACTIVE' } }, select: { userId: true } });
      return rows.map((r) => r.userId);
    }
    const s = f.segment ?? {};
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        onboardedAt: { not: null },
        ...(s.audience && { audience: s.audience }),
        ...(s.classLevels?.length && { classLevel: { in: s.classLevels } }),
        ...(s.inactiveDays && { OR: [{ lastActiveOn: null }, { lastActiveOn: { lt: new Date(Date.now() - s.inactiveDays * 86_400_000) } }] }),
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  async preview(input: CampaignInput) {
    const filter = await this.filterFor(input);
    const ids = await this.audienceUserIds({ audience: input.audience, filter: filter as Prisma.JsonValue });
    const count = ids === 'ALL' ? await this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }) : ids.length;
    const devices =
      ids === 'ALL'
        ? await this.prisma.pushDevice.count({ where: { active: true } })
        : await this.prisma.pushDevice.count({ where: { active: true, userId: { in: ids } } });
    return { students: count, devices, notFound: (filter as { notFound?: string[] }).notFound ?? [] };
  }

  private async filterFor(input: CampaignInput): Promise<Prisma.InputJsonObject> {
    if (input.audience === 'USERS') {
      const r = await this.resolveUsers(input.userRefs);
      return { userIds: r.userIds, notFound: r.notFound };
    }
    if (input.audience === 'TOURNAMENT') return { tournamentId: input.tournamentId! };
    if (input.audience === 'EXAM') return { examId: input.examId! };
    if (input.audience === 'SEGMENT') return { segment: (input.segment ?? {}) as Prisma.InputJsonObject };
    return {};
  }

  async create(input: CampaignInput, actor: AuditActor) {
    const filter = await this.filterFor(input);
    if (input.audience === 'USERS' && !(filter.userIds as string[]).length) throw new BadRequestException('None of the listed students were found');
    const sendAt = input.sendAt ? new Date(input.sendAt) : new Date();
    const c = await this.prisma.notificationCampaign.create({
      data: {
        audience: input.audience, filter, category: input.category, titleEn: input.titleEn, titleHi: input.titleHi || null,
        bodyEn: input.bodyEn, bodyHi: input.bodyHi || null, link: input.link || null, push: input.push, inbox: input.inbox,
        sendAt, createdById: actor.id!,
      },
    });
    await this.audit.log(actor, { action: 'notification.campaign_create', entityType: 'NotificationCampaign', entityId: c.id, meta: { audience: input.audience, sendAt, titleEn: input.titleEn } });
    if (sendAt <= new Date()) await this.dispatch(c.id);
    return this.prisma.notificationCampaign.findUniqueOrThrow({ where: { id: c.id } });
  }

  async dispatch(id: string) {
    const claimed = await this.prisma.notificationCampaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'SENDING' } });
    if (!claimed.count) return;
    const c = await this.prisma.notificationCampaign.findUniqueOrThrow({ where: { id } });
    try {
      const content = { titleEn: c.titleEn, titleHi: c.titleHi, bodyEn: c.bodyEn, bodyHi: c.bodyHi };
      const ids = await this.audienceUserIds(c);
      let target: number;
      if (ids === 'ALL') {
        await this.notifications.writeBroadcast(content, { category: c.category, push: c.push, inbox: c.inbox, link: c.link, campaignId: c.id, createdById: c.createdById });
        target = await this.prisma.user.count({ where: { deletedAt: null, status: 'ACTIVE' } });
      } else {
        target = ids.length;
        if (ids.length) await this.notifications.writeForUsers(ids, content, { category: c.category, eventKey: 'CUSTOM', push: c.push, inbox: c.inbox, link: c.link, campaignId: c.id });
      }
      await this.prisma.notificationCampaign.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), targetCount: target } });
    } catch (e) {
      this.logger.error(e);
      await this.prisma.notificationCampaign.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) } });
    }
  }

  async cancel(id: string, actor: AuditActor) {
    const res = await this.prisma.notificationCampaign.updateMany({ where: { id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    if (!res.count) throw new ConflictException('Only scheduled campaigns can be cancelled');
    await this.audit.log(actor, { action: 'notification.campaign_cancel', entityType: 'NotificationCampaign', entityId: id });
    return { ok: true };
  }

  async list() {
    const campaigns = await this.prisma.notificationCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const ids = campaigns.map((c) => c.id);
    const [opens, outbox] = await Promise.all([
      this.prisma.notificationRead.groupBy({ by: ['notificationId'], where: { openedAt: { not: null }, notification: { campaignId: { in: ids } } }, _count: true }),
      this.prisma.pushOutbox.findMany({ where: { notification: { campaignId: { in: ids } } }, select: { sent: true, failed: true, skipped: true, status: true, notification: { select: { campaignId: true } } } }),
    ]);
    const notifCampaign = await this.prisma.notification.findMany({ where: { id: { in: opens.map((o) => o.notificationId) } }, select: { id: true, campaignId: true } });
    const openBy = new Map<string, number>();
    for (const o of opens) {
      const cid = notifCampaign.find((n) => n.id === o.notificationId)?.campaignId;
      if (cid) openBy.set(cid, (openBy.get(cid) ?? 0) + o._count);
    }
    return campaigns.map((c) => {
      const jobs = outbox.filter((o) => o.notification.campaignId === c.id);
      return {
        ...c,
        stats: {
          pushSent: jobs.reduce((s, j) => s + j.sent, 0),
          pushFailed: jobs.reduce((s, j) => s + j.failed, 0),
          pushSkipped: jobs.reduce((s, j) => s + j.skipped, 0),
          pushPending: jobs.some((j) => j.status === 'PENDING' || j.status === 'PROCESSING'),
          opened: openBy.get(c.id) ?? 0,
        },
      };
    });
  }

  async get(id: string) {
    const c = await this.prisma.notificationCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return c;
  }
}
