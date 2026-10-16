import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { AdminUser, User } from '@prisma/client';
import {
  adminFlagSchema,
  flagReviewSchema,
  Permission,
  attestChallengeSchema,
  proctorFlagSchema,
  proctorPreflightSchema,
  proctorReasonSchema,
  proctorWarnSchema,
  type ProctorPreflightInput,
} from '@testwise/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentAdmin, CurrentUser, RequirePermission, UserAuthGuard } from '../common/auth.guards';
import type { AuditActor } from '../common/audit.service';
import { PrivateStorageService } from '../common/storage.service';
import { ZodPipe } from '../common/zod.pipe';
import { AnswerAnalysisService } from './answer-analysis.service';
import { LiveKitService } from './livekit.service';
import { ProctoringService } from './proctoring.service';

const MAX_EVIDENCE = Number(process.env.EVIDENCE_MAX_MB ?? 8) * 1024 * 1024;

@Controller('v1/proctor')
export class ProctorController {
  constructor(
    private readonly proctoring: ProctoringService,
    private readonly storage: PrivateStorageService,
  ) {}

  /** Payload for the pre-exam speed test: the app times a download of this many bytes (capped) and a few tiny round trips. */
  @Get('netcheck')
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  netcheck(@Query('bytes') bytes: string | undefined, @Res() res: Response) {
    const n = Math.max(0, Math.min(512 * 1024, Number(bytes) || 0));
    res.set({ 'cache-control': 'no-store', 'content-type': 'application/octet-stream' });
    res.send(n ? Buffer.alloc(n, 97) : Buffer.alloc(0));
  }

  /** One-time nonce the app binds its Play Integrity / App Attest proof to. */
  @Post('attest/challenge')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  challenge(@CurrentUser() u: User, @Body(new ZodPipe(attestChallengeSchema)) _body: z.infer<typeof attestChallengeSchema>) {
    return this.proctoring.attestChallenge(u.id);
  }

  @Post('attempts/:attemptId/reattest')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reattest(@CurrentUser() u: User, @Param('attemptId') attemptId: string, @Body(new ZodPipe(z.object({ challengeId: z.string().max(80), attestation: proctorPreflightSchema.shape.attestation }))) body: { challengeId: string; attestation: ProctorPreflightInput['attestation'] }) {
    return this.proctoring.reattest(u.id, attemptId, body);
  }

  @Post('preflight')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preflight(@CurrentUser() u: User, @Body(new ZodPipe(proctorPreflightSchema)) body: ProctorPreflightInput) {
    return this.proctoring.preflight(u.id, body);
  }

  /** Multipart: `data` (JSON flag) + up to 2 `evidence` files (jpeg snapshot, audio clip). */
  @Post('attempts/:attemptId/flags')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(FilesInterceptor('evidence', 2, { limits: { fileSize: MAX_EVIDENCE } }))
  flag(@CurrentUser() u: User, @Param('attemptId') attemptId: string, @Body('data') data: string | undefined, @Body() json: unknown, @UploadedFiles() files: Express.Multer.File[] = []) {
    let raw: unknown = json;
    if (typeof data === 'string') {
      try {
        raw = JSON.parse(data);
      } catch {
        throw new BadRequestException('data must be JSON');
      }
    }
    const parsed = proctorFlagSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid flag', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (parsed.data.type === 'ADMIN_NOTE') throw new ForbiddenException();
    return this.proctoring.ingestFlag(u.id, attemptId, parsed.data, files);
  }

  @Post('attempts/:attemptId/snapshot')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 2 * 1024 * 1024 } }))
  snapshot(@CurrentUser() u: User, @Param('attemptId') attemptId: string, @Body('faces') faces: string | undefined, @UploadedFile() file?: Express.Multer.File) {
    const n = faces === undefined || faces === '' ? null : Number(faces);
    return this.proctoring.snapshot(u.id, attemptId, file, n !== null && Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : null);
  }

  @Get('attempts/:attemptId/live-token')
  @UseGuards(UserAuthGuard)
  liveToken(@CurrentUser() u: User, @Param('attemptId') attemptId: string) {
    return this.proctoring.liveTokenForStudent(u.id, attemptId);
  }

  /** Evidence download via short-lived signed URL (generated only in admin responses). */
  @Get('evidence')
  async evidence(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!this.storage.verify(key, exp, sig)) {
      res.status(403).json({ message: 'Link expired' });
      return;
    }
    const data = await this.storage.read(key).catch(() => null);
    if (!data) {
      res.status(404).json({ message: 'Evidence no longer available (retention period ended)' });
      return;
    }
    res.setHeader('Content-Type', this.storage.mimeOf(key));
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(data);
  }
}

@Controller('v1/admin/proctor')
@UseGuards(AdminAuthGuard)
export class AdminProctorController {
  constructor(
    private readonly proctoring: ProctoringService,
    private readonly livekit: LiveKitService,
    private readonly analysis: AnswerAnalysisService,
  ) {}

  @Get('overview')
  @RequirePermission(Permission.PROCTOR_VIEW)
  overview() {
    return this.proctoring.overview();
  }

  @Get('sessions')
  @RequirePermission(Permission.PROCTOR_VIEW)
  sessions(@Query('tournamentId') tournamentId?: string, @Query('testId') testId?: string, @Query('status') status?: string, @Query('practice') practice?: string) {
    return this.proctoring.sessions({ tournamentId, testId, status, practice: practice === '1' });
  }

  @Get('sessions/:id')
  @RequirePermission(Permission.PROCTOR_VIEW)
  session(@Param('id') id: string) {
    return this.proctoring.session(id);
  }

  @Get('flags')
  @RequirePermission(Permission.PROCTOR_VIEW)
  flags(@Query('status') status?: string, @Query('severity') severity?: string, @Query('type') type?: string, @Query('tournamentId') tournamentId?: string, @Query('userId') userId?: string, @Query('testId') testId?: string) {
    return this.proctoring.flags({ status, severity, type, tournamentId, testId, userId });
  }

  @Post('flags/:id/review')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  review(@Param('id') id: string, @Body(new ZodPipe(flagReviewSchema)) body: z.infer<typeof flagReviewSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.reviewFlag(id, body.status, body.note, actor);
  }

  @Post('sessions/:id/warn')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  warn(@Param('id') id: string, @Body(new ZodPipe(proctorWarnSchema)) body: z.infer<typeof proctorWarnSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.warn(id, body.message, actor);
  }

  @Post('sessions/:id/terminate')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  terminate(@Param('id') id: string, @Body(new ZodPipe(proctorReasonSchema)) body: z.infer<typeof proctorReasonSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.terminate(id, body.reason, actor);
  }

  @Post('sessions/:id/block')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  block(@Param('id') id: string, @Body(new ZodPipe(proctorReasonSchema)) body: z.infer<typeof proctorReasonSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.block(id, body.reason, actor);
  }

  /** Re-run answer-pattern analysis (timing + collusion) for one attempt or a whole tournament, e.g. after changing thresholds. */
  @Post('sessions/:id/analyse')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  async analyse(@Param('id') id: string) {
    const s = await this.proctoring.session(id);
    return this.analysis.analyseAttempt(s.attemptId);
  }

  @Post('analysis/tournaments/:tournamentId')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  analyseTournament(@Param('tournamentId') tournamentId: string) {
    return this.analysis.analyseTournament(tournamentId);
  }

  @Post('attempts/:attemptId/reinstate')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  reinstate(@Param('attemptId') attemptId: string, @Body(new ZodPipe(z.object({ reason: z.string().trim().min(3).max(300), minutes: z.number().int().min(1).max(240).optional() }))) body: { reason: string; minutes?: number }, @AdminActor() actor: AuditActor) {
    return this.proctoring.reinstateAttempt(attemptId, body, actor);
  }

  @Post('sessions/:id/disqualify')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  disqualify(@Param('id') id: string, @Body(new ZodPipe(proctorReasonSchema)) body: z.infer<typeof proctorReasonSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.disqualify(id, body.reason, actor);
  }

  @Post('sessions/:id/ban-device')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  banDevice(@Param('id') id: string, @Body(new ZodPipe(proctorReasonSchema)) body: z.infer<typeof proctorReasonSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.banDevice(id, body.reason, actor);
  }

  @Get('banned-devices')
  @RequirePermission(Permission.PROCTOR_VIEW)
  banned() {
    return this.proctoring.bannedDevices();
  }

  @Post('banned-devices/:id/lift')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  lift(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.proctoring.liftDeviceBan(id, actor);
  }

  @Post('sessions/:id/flags')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  addFlag(@Param('id') id: string, @Body(new ZodPipe(adminFlagSchema)) body: z.infer<typeof adminFlagSchema>, @AdminActor() actor: AuditActor) {
    return this.proctoring.adminFlag(id, body, actor);
  }

  @Post('sessions/:id/evidence')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_EVIDENCE } }))
  capture(@Param('id') id: string, @Body('message') message: string | undefined, @AdminActor() actor: AuditActor, @UploadedFile() file?: Express.Multer.File) {
    return this.proctoring.adminEvidence(id, file, (message ?? 'Captured from live view').slice(0, 300), actor);
  }

  @Post('sessions/:id/live')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_VIEW)
  live(@Param('id') id: string, @AdminActor() actor: AuditActor, @CurrentAdmin() admin: AdminUser) {
    return this.proctoring.startLive(id, { ...actor, name: admin.name });
  }

  @Post('sessions/:id/live/stop')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_VIEW)
  stopLive(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.proctoring.stopLive(id, actor);
  }

  @Get('live/status')
  @RequirePermission(Permission.PROCTOR_VIEW)
  liveStatus() {
    return { configured: this.livekit.isConfigured(), url: this.livekit.url || null };
  }

  @Post('retention/run')
  @HttpCode(200)
  @RequirePermission(Permission.PROCTOR_ACT)
  retention() {
    return this.proctoring.applyRetention();
  }
}
