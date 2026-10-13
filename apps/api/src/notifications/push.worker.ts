import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma, PushOutbox } from '@prisma/client';
import { CATEGORY_INFO, type NotificationCategory } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../common/prisma.service';
import { ApnsSender, FcmSender, type PushSender } from './push.providers';
import { istDayStart } from '../engagement/engagement.services';

const PAGE = 500;

/** Drains the push outbox: resolves target devices, applies preferences and limits, sends via FCM/APNs. */
@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  readonly senders: Record<'FCM' | 'APNS', PushSender> = { FCM: new FcmSender(), APNS: new ApnsSender() };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.redis.withLock('job:push', 30_000, () => this.tick()), 2000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  status() {
    return (Object.values(this.senders) as PushSender[]).map((s) => ({ provider: s.name, configured: s.isConfigured(), hint: s.configHint() }));
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.pushOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 20 });
      for (const job of due) {
        const claimed = await this.prisma.pushOutbox.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
        if (claimed.count) await this.process(job);
      }
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
  }

  private deviceWhere(job: PushOutbox): Prisma.PushDeviceWhereInput {
    const base: Prisma.PushDeviceWhereInput = { active: true, user: { status: 'ACTIVE', deletedAt: null } };
    if (job.audience === 'USER') return { ...base, userId: job.userId! };
    if (job.audience === 'USERS') return { ...base, userId: { in: job.userIds } };
    if (job.audience === 'TOURNAMENT') return { ...base, user: { status: 'ACTIVE', deletedAt: null, registrations: { some: { tournamentId: job.tournamentId! } } } };
    return base;
  }

  async process(job: PushOutbox) {
    try {
      const n = await this.prisma.notification.findUniqueOrThrow({ where: { id: job.notificationId } });
      const category = n.category as NotificationCategory;
      const { maxPromotionsPerDay } = await this.config.get('notifications.schedule');
      let cursor = job.cursor;
      let sent = job.sent;
      let failed = job.failed;
      let skipped = job.skipped;

      for (;;) {
        const devices = await this.prisma.pushDevice.findMany({
          where: { ...this.deviceWhere(job), ...(cursor && { id: { gt: cursor } }) },
          orderBy: { id: 'asc' },
          take: PAGE,
          include: { user: { select: { language: true } } },
        });
        if (!devices.length) break;
        cursor = devices[devices.length - 1].id;
        const userIds = [...new Set(devices.map((d) => d.userId))];

        // Category opt-outs (only for categories students are allowed to mute).
        const muted = CATEGORY_INFO[category]?.mutable
          ? new Set((await this.prisma.notificationSetting.findMany({ where: { userId: { in: userIds }, category, push: false }, select: { userId: true } })).map((m) => m.userId))
          : new Set<string>();

        // Daily cap on promotional pushes.
        const capped = new Set<string>();
        if (category === 'PROMOTIONS') {
          const today = await this.prisma.pushDelivery.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds }, status: 'SENT', createdAt: { gte: istDayStart() }, outbox: { notification: { category: 'PROMOTIONS' } } },
            _count: true,
          });
          for (const r of today) if (r._count >= maxPromotionsPerDay) capped.add(r.userId);
        }

        const deliveries: Prisma.PushDeliveryCreateManyInput[] = [];
        const groups = new Map<string, typeof devices>();
        for (const d of devices) {
          if (muted.has(d.userId) || capped.has(d.userId)) {
            deliveries.push({ outboxId: job.id, deviceId: d.id, userId: d.userId, provider: d.provider, status: 'SKIPPED', error: muted.has(d.userId) ? 'Muted by student' : 'Daily promotion limit' });
            skipped++;
            continue;
          }
          const lang = d.user.language === 'HI' && n.titleHi ? 'HI' : 'EN';
          const key = `${d.provider}:${lang}`;
          groups.set(key, [...(groups.get(key) ?? []), d]);
        }

        for (const [key, group] of groups) {
          const [provider, lang] = key.split(':') as ['FCM' | 'APNS', 'EN' | 'HI'];
          const sender = this.senders[provider];
          if (!sender.isConfigured()) {
            for (const d of group) deliveries.push({ outboxId: job.id, deviceId: d.id, userId: d.userId, provider, status: 'SKIPPED', error: sender.configHint() });
            skipped += group.length;
            continue;
          }
          const results = await sender.send(
            group.map((d) => d.token),
            {
              title: lang === 'HI' ? n.titleHi! : n.titleEn,
              body: lang === 'HI' && n.bodyHi ? n.bodyHi : n.bodyEn,
              category,
              data: { batchId: job.id, link: n.link ?? '', category, notificationId: n.id },
            },
          );
          const invalid: string[] = [];
          results.forEach((r, i) => {
            const d = group[i];
            if (r.ok) {
              sent++;
              deliveries.push({ outboxId: job.id, deviceId: d.id, userId: d.userId, provider, status: 'SENT' });
            } else {
              failed++;
              if (r.invalid) invalid.push(d.id);
              deliveries.push({ outboxId: job.id, deviceId: d.id, userId: d.userId, provider, status: r.invalid ? 'INVALID_TOKEN' : 'FAILED', error: r.error });
            }
          });
          if (invalid.length) await this.prisma.pushDevice.updateMany({ where: { id: { in: invalid } }, data: { active: false } });
        }
        if (deliveries.length) await this.prisma.pushDelivery.createMany({ data: deliveries });
        await this.prisma.pushOutbox.update({ where: { id: job.id }, data: { cursor, sent, failed, skipped } });
        if (devices.length < PAGE) break;
      }
      await this.prisma.pushOutbox.update({ where: { id: job.id }, data: { status: 'DONE', finishedAt: new Date(), sent, failed, skipped } });
    } catch (e) {
      const attempts = job.attempts + 1;
      this.logger.error(`Push job ${job.id} failed: ${(e as Error).message}`);
      await this.prisma.pushOutbox.update({
        where: { id: job.id },
        data: attempts >= 5
          ? { status: 'FAILED', error: (e as Error).message.slice(0, 500), finishedAt: new Date() }
          : { status: 'PENDING', error: (e as Error).message.slice(0, 500), nextAttemptAt: new Date(Date.now() + 2 ** attempts * 15_000) },
      });
    }
  }
}
