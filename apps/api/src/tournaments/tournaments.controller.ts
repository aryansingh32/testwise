import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { TournamentStatus } from '@prisma/client';
import { Permission, ruleChangeSchema, tournamentSchema, tournamentTransitionSchema, type TournamentInput } from '@testwise/shared';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, RequirePermission } from '../common/auth.guards';
import type { AuditActor } from '../common/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { TournamentsService } from './tournaments.service';

const updateSchema = z.object({
  tournament: tournamentSchema,
  change: ruleChangeSchema.partial().default({}),
});

@Controller('v1/tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  list(@Query('group') group?: string, @Query('examId') examId?: string, @Query('entryMode') entryMode?: string) {
    return this.tournaments.listPublic({ group, examId, entryMode });
  }

  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.tournaments.detailPublic(slug);
  }
}

@Controller('v1/admin/tournaments')
@UseGuards(AdminAuthGuard)
export class AdminTournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get()
  @RequirePermission(Permission.TOURNAMENT_READ)
  list(@Query('status') status?: TournamentStatus, @Query('q') q?: string) {
    return this.tournaments.listAdmin({ status, q });
  }

  @Get(':id')
  @RequirePermission(Permission.TOURNAMENT_READ)
  get(@Param('id') id: string) {
    return this.tournaments.getAdmin(id);
  }

  @Post()
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  create(@Body(new ZodPipe(tournamentSchema)) body: TournamentInput, @AdminActor() actor: AuditActor) {
    return this.tournaments.create(body, actor);
  }

  @Put(':id')
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @AdminActor() actor: AuditActor) {
    return this.tournaments.update(id, body.tournament, body.change, actor);
  }

  @Post(':id/duplicate')
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  duplicate(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.tournaments.duplicate(id, actor);
  }

  @Post(':id/transition')
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  transition(@Param('id') id: string, @Body(new ZodPipe(tournamentTransitionSchema)) body: z.infer<typeof tournamentTransitionSchema>, @AdminActor() actor: AuditActor) {
    return this.tournaments.transition(id, body.to, body.reason, actor);
  }

  @Delete(':id')
  @RequirePermission(Permission.TOURNAMENT_WRITE)
  remove(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.tournaments.remove(id, actor);
  }
}
