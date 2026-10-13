import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenOwner } from '@prisma/client';
import { createHash, createSecretKey, randomBytes, type KeyObject } from 'crypto';
import { PrismaService } from './prisma.service';

const ACCESS_TTL_SECONDS = { USER: 15 * 60, ADMIN: 30 * 60 } as const;
const REFRESH_TTL_DAYS = { USER: 30, ADMIN: 1 } as const;
const REUSE_GRACE_MS = 10_000;

export interface AccessPayload {
  sub: string;
  typ: 'user' | 'admin';
  role?: string;
}

export interface ProctorClearance {
  sub: string;
  /** tournament slug or test id */
  ref: string;
  mode: 'BASIC' | 'AI' | 'LIVE';
  consentVersion: string;
  deviceId: string | null;
  device: unknown;
  integrity: unknown;
  /** Verified attestation summary (level, deviceHash), recorded on the session. */
  attestation?: unknown;
  consent?: unknown;
  network?: unknown;
  /** LiveKit room key allocated at preflight (LIVE mode). */
  liveRoom?: string | null;
  features?: unknown;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Issues JWT access tokens and opaque, rotating refresh tokens.
 * Temporary auth until Firebase is connected; Firebase will replace the
 * student login step but these tokens remain the API session.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly keyObjects = new Map<string, KeyObject>();

  /**
   * Verification key as a KeyObject. jsonwebtoken otherwise tries createPublicKey(string) on every verify
   * (throws, then falls back), which was ~14% of API CPU under load.
   */
  private verifyKey(owner: TokenOwner): string {
    const secret = this.secret(owner);
    let key = this.keyObjects.get(secret);
    if (!key) {
      key = createSecretKey(Buffer.from(secret));
      this.keyObjects.set(secret, key);
    }
    return key as unknown as string;
  }

  private secret(owner: TokenOwner) {
    const s = owner === 'USER' ? process.env.JWT_USER_SECRET : process.env.JWT_ADMIN_SECRET;
    if (!s || s.length < 32) throw new Error(`JWT secret for ${owner} is missing or too short`);
    return s;
  }

  async issue(owner: TokenOwner, subjectId: string, role?: string) {
    const payload: AccessPayload = { sub: subjectId, typ: owner === 'USER' ? 'user' : 'admin', role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.secret(owner),
      expiresIn: ACCESS_TTL_SECONDS[owner],
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        owner,
        userId: owner === 'USER' ? subjectId : null,
        adminId: owner === 'ADMIN' ? subjectId : null,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS[owner] * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS[owner] };
  }

  async verifyAccess(owner: TokenOwner, token: string): Promise<AccessPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, { secret: this.verifyKey(owner), algorithms: ['HS256'] });
      if (payload.typ !== (owner === 'USER' ? 'user' : 'admin')) throw new Error('wrong token type');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Rotate a refresh token. The revoke is one atomic conditional UPDATE, so of N parallel refreshes with the same token
   * exactly one wins. Presenting an already-rotated token revokes the whole family for that subject (it is either theft
   * or a client that lost its new token), except within REUSE_GRACE_MS of the rotation, where it is almost certainly the
   * same client racing itself (double resume, two tabs): that request is refused but nobody is signed out.
   */
  async rotate(owner: TokenOwner, refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!record || record.owner !== owner) throw new UnauthorizedException('Invalid refresh token');
    const subjectId = (owner === 'USER' ? record.userId : record.adminId)!;
    if (record.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    const won = await this.prisma.refreshToken.updateMany({ where: { id: record.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (won.count === 1) return { subjectId };
    const rotatedAt = record.revokedAt ?? (await this.prisma.refreshToken.findUnique({ where: { id: record.id }, select: { revokedAt: true } }))?.revokedAt ?? null;
    if (rotatedAt && Date.now() - rotatedAt.getTime() < REUSE_GRACE_MS) throw new UnauthorizedException('Refresh token was just used; retry with the newest token');
    await this.revokeAll(owner, subjectId);
    throw new UnauthorizedException('Refresh token reuse detected; please sign in again');
  }

  async revoke(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Short-lived proof that a student passed the proctoring pre-check for one test. */
  signProctor(payload: ProctorClearance) {
    return this.jwt.signAsync({ ...payload, typ: 'proctor' }, { secret: this.secret('USER'), expiresIn: 15 * 60 });
  }

  async verifyProctor(token: string): Promise<ProctorClearance> {
    try {
      const p = await this.jwt.verifyAsync<ProctorClearance & { typ: string }>(token, { secret: this.verifyKey('USER'), algorithms: ['HS256'] });
      if (p.typ !== 'proctor') throw new Error('wrong token type');
      return p;
    } catch {
      throw new UnauthorizedException('Proctoring check expired. Run the device check again.');
    }
  }

  async revokeAll(owner: TokenOwner, subjectId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { owner, revokedAt: null, ...(owner === 'USER' ? { userId: subjectId } : { adminId: subjectId }) },
      data: { revokedAt: new Date() },
    });
  }
}
