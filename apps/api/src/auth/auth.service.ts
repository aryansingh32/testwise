import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthResponse, LoginInput, OnboardingInput, RegisterInput } from '@testwise/shared';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../common/redis.service';
import { FirebaseVerifier } from './firebase-verifier';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditService } from '../common/audit.service';
import { istDateKey, XpService } from '../engagement/engagement.services';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../common/tokens.service';
import { ageOn, toMeDto } from './user-mapper';

const withExams = { exams: { select: { examId: true } } } as const;

const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCK_SECONDS = 15 * 60;
/** Valid bcrypt hash (same cost as real ones) used to equalise timing for unknown emails. */
const DUMMY_HASH = bcrypt.hash('timing-equaliser', 12);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly xp: XpService,
    private readonly firebaseVerifier: FirebaseVerifier,
    private readonly redis: RedisService,
  ) {}

  private async requireMethod(method: 'emailPassword' | 'google' | 'phoneOtp') {
    const methods = await this.config.get('auth.methods');
    if (!methods[method]) throw new ForbiddenException('This sign-in method is currently disabled');
  }

  private async session(user: User): Promise<AuthResponse> {
    const tokens = await this.tokens.issue('USER', user.id);
    const full = await this.touchStreak(user.id);
    const { adultAge } = await this.config.get('policy.age');
    return { ...tokens, user: toMeDto(full, adultAge) };
  }

  async register(input: RegisterInput) {
    await this.requireMethod('emailPassword');
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        displayName: input.displayName,
        authProvider: 'PASSWORD',
      },
    });
    await this.audit.log({ type: 'USER', id: user.id }, { action: 'user.register', entityType: 'User', entityId: user.id });
    return this.session(user);
  }

  async login(input: LoginInput) {
    await this.requireMethod('emailPassword');
    // Per-account lockout on top of the per-IP throttle: a distributed attack on one account is otherwise unbounded.
    const failKey = `login-fail:${input.email}`;
    if ((await this.redis.counter(failKey)) >= MAX_LOGIN_FAILURES) {
      throw new HttpException('Too many failed sign-in attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Always run one bcrypt compare so an unknown email takes as long as a wrong password (no timing-based enumeration).
    const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user?.passwordHash || !passwordOk) {
      await this.redis.incr(failKey, LOGIN_LOCK_SECONDS);
      throw new UnauthorizedException('Incorrect email or password');
    }
    await this.redis.resetCounter(failKey);
    if (user.status !== 'ACTIVE' || user.deletedAt) throw new ForbiddenException('Account suspended');
    return this.session(user);
  }

  async refresh(refreshToken: string) {
    const { subjectId } = await this.tokens.rotate('USER', refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: subjectId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account unavailable');
    return this.session(user);
  }

  logout(refreshToken: string) {
    return this.tokens.revoke(refreshToken);
  }

  /**
   * Sign in with a Firebase ID token (Google or phone OTP). The token is verified with Google; the account is found by
   * Firebase uid, then linked by a *verified* email or phone, otherwise created. An unverified email never links to an
   * existing account, so nobody can take over an account by claiming its address.
   */
  async firebase(idToken: string) {
    const f = await this.firebaseVerifier.verify(idToken);
    if (f.provider === 'google.com') await this.requireMethod('google');
    else if (f.provider === 'phone') await this.requireMethod('phoneOtp');
    else throw new ForbiddenException('This sign-in method is not supported');

    let user = await this.prisma.user.findUnique({ where: { firebaseUid: f.uid } });
    if (!user && f.email && f.emailVerified) user = await this.prisma.user.findUnique({ where: { email: f.email.toLowerCase() } });
    if (!user && f.phone) user = await this.prisma.user.findUnique({ where: { phone: f.phone } });
    if (user) {
      if (user.status !== 'ACTIVE' || user.deletedAt) throw new ForbiddenException('Account suspended');
      if (user.firebaseUid !== f.uid) {
        const linked = await this.prisma.user.findUnique({ where: { firebaseUid: f.uid } });
        if (linked && linked.id !== user.id) throw new ConflictException('This sign-in is already linked to another account');
        user = await this.prisma.user.update({ where: { id: user.id }, data: { firebaseUid: f.uid, ...(f.phone && !user.phone && { phone: f.phone }) } });
        await this.audit.log({ type: 'USER', id: user.id }, { action: 'user.firebase_link', entityType: 'User', entityId: user.id, meta: { provider: f.provider } });
      }
      return this.session(user);
    }
    const created = await this.prisma.user.create({
      data: {
        firebaseUid: f.uid,
        email: f.email && f.emailVerified ? f.email.toLowerCase() : null,
        phone: f.phone,
        displayName: (f.name ?? '').trim().slice(0, 60) || (f.phone ? `Student ${f.phone.slice(-4)}` : 'Student'),
        authProvider: f.provider === 'phone' ? 'PHONE' : 'GOOGLE',
      },
    });
    await this.audit.log({ type: 'USER', id: created.id }, { action: 'user.register', entityType: 'User', entityId: created.id, meta: { provider: f.provider } });
    return this.session(created);
  }

  async me(userId: string) {
    const user = await this.touchStreak(userId);
    const { adultAge } = await this.config.get('policy.age');
    return toMeDto(user, adultAge);
  }

  /** userId -> day marker for which the login XP + streak were already applied by this replica (the DB writes stay idempotent). */
  private readonly streakDone = new Map<string, string>();

  /** Daily streak: +1 if last active yesterday, reset to 1 after a gap. */
  private async touchStreak(userId: string) {
    const marker = istDateKey();
    if (this.streakDone.get(userId) === marker) return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: withExams });
    const user = await this.applyStreak(userId);
    if (this.streakDone.size >= 200_000) this.streakDone.clear();
    this.streakDone.set(userId, marker);
    return user;
  }

  private async applyStreak(userId: string) {
    const { perDailyLogin } = await this.config.get('gamification.xp');
    await this.xp.award(userId, perDailyLogin, 'login', istDateKey());
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: withExams });
    // The streak day is the IST calendar day, matching daily-login XP and missions (a UTC day would split an evening-to-morning study session).
    const today = new Date(`${istDateKey()}T00:00:00.000Z`);
    const last = user.lastActiveOn;
    if (last && last.getTime() === today.getTime()) return user;
    const yesterday = new Date(today.getTime() - 86_400_000);
    const streakDays = last && last.getTime() === yesterday.getTime() ? user.streakDays + 1 : 1;
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveOn: today, streakDays },
      include: withExams,
    });
  }

  async onboard(userId: string, input: OnboardingInput) {
    const age = await this.config.get('policy.age');
    const dob = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
    if (dob && (dob > new Date() || ageOn(dob) < 5)) throw new BadRequestException('Please enter a valid date of birth');
    const minor = dob ? ageOn(dob) < age.adultAge : input.audience === 'SCHOOL';
    if (minor && age.minorRequiresGuardianConsent && !input.guardianConsent) {
      throw new BadRequestException('A parent or guardian must consent for students under ' + age.adultAge);
    }
    if (input.examIds.length) {
      const count = await this.prisma.exam.count({ where: { id: { in: input.examIds }, active: true } });
      if (count !== input.examIds.length) throw new BadRequestException('Unknown exam selected');
    }
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.userExam.deleteMany({ where: { userId } });
      if (input.examIds.length) {
        await tx.userExam.createMany({ data: input.examIds.map((examId) => ({ userId, examId })) });
      }
      return tx.user.update({
        where: { id: userId },
        data: {
          audience: input.audience,
          classLevel: input.audience === 'SCHOOL' ? input.classLevel : null,
          board: input.audience === 'SCHOOL' ? input.board : null,
          dateOfBirth: dob,
          guardianConsent: input.guardianConsent ?? false,
          language: input.language,
          onboardedAt: new Date(),
        },
        include: withExams,
      });
    });
    return toMeDto(user, age.adultAge);
  }

  async updatePreferences(userId: string, input: { language?: 'EN' | 'HI'; displayName?: string }) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: input, include: withExams });
    const { adultAge } = await this.config.get('policy.age');
    return toMeDto(user, adultAge);
  }
}
