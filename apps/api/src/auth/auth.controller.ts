import { z } from 'zod';
import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import {
  loginSchema,
  onboardingSchema,
  preferencesSchema,
  refreshSchema,
  registerSchema,
  type LoginInput,
  type OnboardingInput,
  type RegisterInput,
} from '@testwise/shared';
import { CurrentUser, UserAuthGuard } from '../common/auth.guards';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body(new ZodPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
  }

  /** Google or phone-OTP sign-in: the app sends the Firebase ID token it received; the server verifies it. */
  @Post('firebase')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  firebase(@Body(new ZodPipe(z.object({ idToken: z.string().min(100).max(4000) }))) body: { idToken: string }) {
    return this.auth.firebase(body.idToken);
  }
}

@Controller('v1/me')
@UseGuards(UserAuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentUser() user: User) {
    return this.auth.me(user.id);
  }

  @Patch('onboarding')
  onboard(@CurrentUser() user: User, @Body(new ZodPipe(onboardingSchema)) body: OnboardingInput) {
    return this.auth.onboard(user.id, body);
  }

  @Patch('preferences')
  preferences(@CurrentUser() user: User, @Body(new ZodPipe(preferencesSchema)) body: { language?: 'EN' | 'HI'; displayName?: string }) {
    return this.auth.updatePreferences(user.id, body);
  }
}
