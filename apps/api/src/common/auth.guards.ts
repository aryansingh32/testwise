import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminUser, User } from '@prisma/client';
import { hasPermission, type Permission } from '@testwise/shared';
import type { Request } from 'express';
import type { AuditActor } from './audit.service';
import { PrismaService } from './prisma.service';
import { TokensService } from './tokens.service';

export interface AuthedRequest extends Request {
  user?: User;
  admin?: AdminUser;
}

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
  return header.slice(7);
}

/** A suspension reaches every replica within this window; the row is otherwise re-read on every request (1 query of ~6ms CPU each). */
const USER_CACHE_TTL_MS = 5_000;
const USER_CACHE_MAX = 50_000;

@Injectable()
export class UserAuthGuard implements CanActivate {
  private readonly userCache = new Map<string, { user: User; exp: number }>();

  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const payload = await this.tokens.verifyAccess('USER', bearer(req));
    const now = Date.now();
    const cached = this.userCache.get(payload.sub);
    if (cached && cached.exp > now) {
      req.user = cached.user;
      return true;
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Account not found');
    if (user.status !== 'ACTIVE') {
      this.userCache.delete(payload.sub);
      throw new ForbiddenException('Account suspended');
    }
    if (this.userCache.size >= USER_CACHE_MAX) this.userCache.clear();
    this.userCache.set(payload.sub, { user, exp: now + USER_CACHE_TTL_MS });
    req.user = user;
    return true;
  }
}

const PERMISSION_KEY = 'requiredPermission';

/** Require an admin permission on a route or controller. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const payload = await this.tokens.verifyAccess('ADMIN', bearer(req));
    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.active) throw new UnauthorizedException('Admin account disabled');
    req.admin = admin;

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (permission && !hasPermission(admin.role, permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user!,
);

export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().admin!,
);

/** Audit actor for the calling admin, including client IP. */
export const AdminActor = createParamDecorator((_: unknown, ctx: ExecutionContext): AuditActor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return { type: 'ADMIN', id: req.admin?.id, ip: req.ip };
});
