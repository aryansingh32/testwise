import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CONFIG_KEYS, CONFIG_REGISTRY, type ConfigKey, type ConfigValue, type PublicAppConfig } from '@testwise/shared';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

const CACHE_SECONDS = 30;
/** In-process layer over Redis: config is read many times per request (Redis GET + JSON.parse + zod each time). */
const LOCAL_TTL_MS = 2_000;

/** Server-side detection tuning that must not be readable from the app (it would tell a cheater exactly where the lines are). */
const SERVER_ONLY: Partial<Record<ConfigKey, string[]>> = {
  'proctoring.policy': ['rules', 'autoTerminateAtPoints', 'autoTerminateOnCritical', 'collusionMinSharedWrong', 'collusionMinRatio', 'minSecondsPerAnswer', 'attestationCertDigests', 'attestationFailOpen', 'blockedApps', 'accessibilityAllowlist'],
};
function redactPublic(key: ConfigKey, value: unknown) {
  const drop = SERVER_ONLY[key];
  if (!drop || typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !drop.includes(k)));
}

@Injectable()
export class AppConfigService {
  private readonly validators = new Map<string, (value: unknown) => string | null>();
  private readonly local = new Map<string, { exp: number; value: unknown }>();
  private publicCache: { exp: number; value: PublicAppConfig } | null = null;

  /** Extra business rules a module enforces on a setting (e.g. a gateway must be configured before it is selected). */
  registerValidator(key: ConfigKey, fn: (value: unknown) => string | null) {
    this.validators.set(key, fn);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  isKey(key: string): key is ConfigKey {
    return key in CONFIG_REGISTRY;
  }

  /** Stored value merged over the registry default, so new fields get defaults. */
  async get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>> {
    const hit = this.local.get(key);
    if (hit && hit.exp > Date.now()) return structuredClone(hit.value) as ConfigValue<K>;
    const def = CONFIG_REGISTRY[key].default as ConfigValue<K>;
    let stored = await this.redis.getJson<{ v: object | null }>(`config:${key}`);
    if (!stored) {
      const row = await this.prisma.appConfig.findUnique({ where: { key } });
      stored = { v: (row?.value as object) ?? null };
      await this.redis.setJson(`config:${key}`, stored, CACHE_SECONDS);
    }
    let value: ConfigValue<K> = def;
    if (stored.v) {
      const parsed = CONFIG_REGISTRY[key].schema.safeParse({ ...def, ...stored.v });
      value = (parsed.success ? parsed.data : def) as ConfigValue<K>;
    }
    this.local.set(key, { exp: Date.now() + LOCAL_TTL_MS, value });
    // Callers get their own copy so one request can never mutate what another reads.
    return structuredClone(value);
  }

  async getPublic(): Promise<PublicAppConfig> {
    if (this.publicCache && this.publicCache.exp > Date.now()) return this.publicCache.value;
    const keys = CONFIG_KEYS.filter((k) => CONFIG_REGISTRY[k].public);
    const values = await Promise.all(keys.map((k) => this.get(k)));
    const out: Record<string, unknown> = {};
    keys.forEach((k, i) => (out[k] = redactPublic(k, values[i])));
    this.publicCache = { exp: Date.now() + LOCAL_TTL_MS, value: out as PublicAppConfig };
    return this.publicCache.value;
  }

  async listForAdmin() {
    const rows = await this.prisma.appConfig.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Promise.all(
      CONFIG_KEYS.map(async (key) => ({
        key,
        label: CONFIG_REGISTRY[key].label,
        description: CONFIG_REGISTRY[key].description,
        public: CONFIG_REGISTRY[key].public,
        value: await this.get(key),
        default: CONFIG_REGISTRY[key].default,
        version: byKey.get(key)?.version ?? 0,
        updatedAt: byKey.get(key)?.updatedAt ?? null,
      })),
    );
  }

  async update(key: string, value: unknown, actor: AuditActor) {
    if (!this.isKey(key)) throw new NotFoundException(`Unknown config key ${key}`);
    const parsed = CONFIG_REGISTRY[key].schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid config value',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const rule = this.validators.get(key)?.(parsed.data);
    if (rule) throw new BadRequestException(rule);
    const newValue = parsed.data as Prisma.InputJsonValue;
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.appConfig.findUnique({ where: { key } });
      const version = (existing?.version ?? 0) + 1;
      const row = await tx.appConfig.upsert({
        where: { key },
        create: { key, value: newValue, version, updatedById: actor.id },
        update: { value: newValue, version, updatedById: actor.id },
      });
      await tx.configChange.create({
        data: {
          key,
          version,
          oldValue: existing ? (existing.value as Prisma.InputJsonValue) : Prisma.DbNull,
          newValue,
          changedById: actor.id!,
        },
      });
      await this.audit.log(
        actor,
        { action: 'config.update', entityType: 'AppConfig', entityId: key, before: existing?.value, after: newValue },
        tx,
      );
      return row;
    });
    await this.redis.del(`config:${key}`);
    this.local.delete(key);
    this.publicCache = null;
    return saved;
  }

  history(key: string) {
    return this.prisma.configChange.findMany({ where: { key }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
