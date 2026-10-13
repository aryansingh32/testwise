import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface AuditActor {
  type: ActorType;
  id?: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

type Tx = Prisma.TransactionClient | PrismaService;

const toJson = (v: unknown) =>
  v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Record an audit event. Pass a transaction client to commit atomically with the change. */
  async log(actor: AuditActor, entry: AuditEntry, tx: Tx = this.prisma) {
    await tx.auditEvent.create({
      data: {
        actorType: actor.type,
        actorId: actor.id ?? null,
        ip: actor.ip ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        meta: toJson(entry.meta),
      },
    });
  }
}
