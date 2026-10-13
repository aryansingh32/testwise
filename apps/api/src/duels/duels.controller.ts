import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import { botPersonaSchema, paidDuelOfferSchema, paidDuelOfferUpdateSchema, Permission } from '@testwise/shared';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentUser, RequirePermission, UserAuthGuard } from '../common/auth.guards';
import type { AuditActor } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { DuelsService } from './duels.service';
import { PaidDuelsService } from './paid-duels.service';

const challengeSchema = z.object({ examId: z.string().optional().nullable() });

@Controller('v1/duels')
@UseGuards(UserAuthGuard)
export class DuelsController {
  constructor(
    private readonly duels: DuelsService,
    private readonly paid: PaidDuelsService,
  ) {}

  @Get('me')
  me(@CurrentUser() u: User) {
    return this.duels.profile(u.id);
  }

  @Get('history')
  history(@CurrentUser() u: User) {
    return this.duels.history(u.id);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() u: User) {
    return this.duels.leaderboard(u.id);
  }

  /** Coin duels an admin has opened. Amounts and eligibility come from the server; the app only picks one. */
  @Get('paid')
  paidOffers(@CurrentUser() u: User) {
    return this.paid.offers(u.id);
  }

  @Post('paid/offers/:id/join')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  joinPaid(@CurrentUser() u: User, @Param('id') id: string) {
    return this.paid.join(u.id, id);
  }

  @Post('paid/rooms/:id/leave')
  @HttpCode(200)
  leavePaid(@CurrentUser() u: User, @Param('id') id: string) {
    return this.paid.leave(u.id, id);
  }

  @Post('challenge')
  challenge(@CurrentUser() u: User, @Body(new ZodPipe(challengeSchema)) body: { examId?: string | null }) {
    return this.duels.createChallenge(u.id, body.examId ?? null);
  }
}

@Controller('v1/admin/duels')
@UseGuards(AdminAuthGuard)
export class AdminDuelsController {
  constructor(private readonly duels: DuelsService) {}

  @Get('stats')
  @RequirePermission(Permission.TOURNAMENT_READ)
  stats() {
    return this.duels.stats();
  }

  @Get()
  @RequirePermission(Permission.TOURNAMENT_READ)
  recent() {
    return this.duels.recent();
  }

  @Get('bots')
  @RequirePermission(Permission.TOURNAMENT_READ)
  personas() {
    return this.duels.personas();
  }

  @Post('bots')
  @RequirePermission(Permission.CONFIG_WRITE)
  create(@Body(new ZodPipe(botPersonaSchema)) body: z.infer<typeof botPersonaSchema>, @AdminActor() actor: AuditActor) {
    return this.duels.savePersona(null, body, actor);
  }

  @Put('bots/:id')
  @RequirePermission(Permission.CONFIG_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(botPersonaSchema)) body: z.infer<typeof botPersonaSchema>, @AdminActor() actor: AuditActor) {
    return this.duels.savePersona(id, body, actor);
  }

  @Delete('bots/:id')
  @RequirePermission(Permission.CONFIG_WRITE)
  remove(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.duels.deletePersona(id, actor);
  }
}


/** Admin: create and run batches of coin duels. */
@Controller('v1/admin/paid-duels')
@UseGuards(AdminAuthGuard)
export class AdminPaidDuelsController {
  constructor(private readonly paid: PaidDuelsService) {}

  @Get()
  @RequirePermission(Permission.TOURNAMENT_READ)
  list() {
    return this.paid.adminOffers();
  }

  @Post()
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  create(@Body(new ZodPipe(paidDuelOfferSchema)) body: z.infer<typeof paidDuelOfferSchema>, @AdminActor() actor: AuditActor) {
    return this.paid.createOffer(body, actor);
  }

  @Patch(':id')
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(paidDuelOfferUpdateSchema)) body: z.infer<typeof paidDuelOfferUpdateSchema>, @AdminActor() actor: AuditActor) {
    return this.paid.updateOffer(id, body, actor);
  }

  @Post('rooms/:id/cancel')
  @HttpCode(200)
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  cancel(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.paid.cancelRoom(id, 'cancelled by an admin', actor);
  }
}
