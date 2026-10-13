import { Controller, Get, Global, Module, Res } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { monitorEventLoopDelay } from 'perf_hooks';
import type { Response } from 'express';
import { lifecycle } from './common/lifecycle';
import { ResilientThrottlerStorage } from './common/resilient-throttler-storage';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { SkipThrottle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AdminAuthController, AdminController } from './admin/admin.controller';
import { AdminFinanceController, AdminResultsController, AdminStoreController, AdminSupportController, AdminTestsController } from './admin/admin-ops.controller';
import { AttemptsService } from './attempts/attempts.service';
import { MissionsService, XpService } from './engagement/engagement.services';
import { NotificationsService } from './notifications/notifications.service';
import { PushWorker } from './notifications/push.worker';
import { CampaignsService } from './notifications/campaigns.service';
import { NotificationScheduler } from './notifications/scheduler.service';
import { AdminNotificationsController, MeNotificationsController } from './notifications/notifications.controller';
import { DuelsService } from './duels/duels.service';
import { DuelsGateway } from './duels/duels.gateway';
import { AdminDuelsController, AdminPaidDuelsController, DuelsController } from './duels/duels.controller';
import { PaidDuelsService } from './duels/paid-duels.service';
import { LedgerService } from './payments/ledger.service';
import { PaymentsService } from './payments/payments.service';
import { PublicController } from './public.controller';
import { ResultsService } from './results/results.service';
import { StoreService } from './store/store.service';
import { StudentController, SupportController } from './student.controller';
import { TestsService } from './tests/tests.service';
import { RegistrationsService } from './tournaments/registrations.service';
import { AdminConfigController, PublicConfigController } from './app-config/app-config.controller';
import { AppConfigService } from './app-config/app-config.service';
import { AuthController, MeController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminTaxonomyController, CatalogController } from './catalog/catalog.controller';
import { AdminCmsController, HomeController } from './cms/cms.controller';
import { AdminAuthGuard, UserAuthGuard } from './common/auth.guards';
import { AuditService } from './common/audit.service';
import { PrismaService } from './common/prisma.service';
import { RedisService } from './common/redis.service';
import { PrivateStorageService, StorageService } from './common/storage.service';
import { TokensService } from './common/tokens.service';
import { ImportService } from './questions/import.service';
import { AdminQuestionsController } from './questions/questions.controller';
import { QuestionsService } from './questions/questions.service';
import { AdminTournamentsController, TournamentsController } from './tournaments/tournaments.controller';
import { TournamentsService } from './tournaments/tournaments.service';
import { AdminWalletController, WalletController } from './wallet/wallet.controller';
import { FirebaseVerifier } from './auth/firebase-verifier';
import { WalletService } from './wallet/wallet.service';
import { GameCoinsService } from './engagement/game-coins.service';
import { AnswerAnalysisService } from './proctoring/answer-analysis.service';
import { AttestationService } from './proctoring/attestation.service';
import { LiveKitService } from './proctoring/livekit.service';
import { AdminProctorController, ProctorController } from './proctoring/proctoring.controller';
import { ProctoringGateway } from './proctoring/proctoring.gateway';
import { ProctorBus, ProctoringService } from './proctoring/proctoring.service';

// Event-loop delay since the last /health read: the earliest sign a replica is CPU-saturated (and what a load balancer or autoscaler should watch).
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

@Controller()
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 503 when the database is unreachable (so a load balancer stops routing here); Redis trouble is reported as `degraded`. */
  @SkipThrottle()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const eventLoopLagMs = { p50: Math.round(loopDelay.percentile(50) / 1e6), p99: Math.round(loopDelay.percentile(99) / 1e6), max: Math.round(loopDelay.max / 1e6) };
    loopDelay.reset();
    const [db, redis] = await Promise.all([
      // A load balancer needs a prompt verdict: an unreachable database must read as DOWN within ~1.5s, not after Prisma's own timeouts.
      Promise.race([this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 1500))]),
      this.redis.ping().then((r) => r, () => 'DOWN'),
    ]);
    // Draining (SIGTERM received): tell the load balancer to stop sending traffic while in-flight requests finish.
    if (!db || lifecycle.draining) res.status(503);
    return { ok: db && !lifecycle.draining, status: lifecycle.draining ? 'draining' : !db ? 'down' : redis === 'DOWN' ? 'degraded' : 'ok', db, redis, duelsEngineEnabled: process.env.DUELS_ENGINE_ENABLED !== 'false', eventLoopLagMs, time: new Date().toISOString() };
  }
}

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [PrismaService, RedisService, AuditService, TokensService, StorageService, PrivateStorageService, AppConfigService, UserAuthGuard, AdminAuthGuard, XpService, NotificationsService, MissionsService, LedgerService, WalletService, GameCoinsService],
  exports: [PrismaService, RedisService, AuditService, TokensService, StorageService, PrivateStorageService, AppConfigService, UserAuthGuard, AdminAuthGuard, JwtModule, XpService, NotificationsService, MissionsService, LedgerService, WalletService, GameCoinsService],
})
class CoreModule {}

/** Push delivery, campaigns and automatic reminders. */
@Module({
  providers: [PushWorker, CampaignsService, NotificationScheduler],
  controllers: [MeNotificationsController, AdminNotificationsController],
})
class NotificationsModule {}

/** 1v1 duels: matchmaking, live engine (Socket.IO /duels), ratings and bots. */
@Module({
  providers: [DuelsService, DuelsGateway, PaidDuelsService],
  controllers: [DuelsController, AdminDuelsController, AdminPaidDuelsController],
})
class DuelsModule {}

/** Tests, attempts, payments, registrations, results and the store: the competition engine. */
@Module({
  providers: [AttemptsService, PaymentsService, ResultsService, RegistrationsService, StoreService, TestsService],
  exports: [AttemptsService, PaymentsService, ResultsService, RegistrationsService, StoreService, TestsService],
  controllers: [StudentController, SupportController, PublicController, AdminTestsController, AdminStoreController, AdminFinanceController, AdminResultsController, AdminSupportController],
})
class CompetitionModule {}

/** Proctoring: device pre-check, flags with evidence, rules, live monitoring (/proctor socket, LiveKit). */
@Module({
  imports: [CompetitionModule],
  providers: [ProctoringService, ProctoringGateway, ProctorBus, LiveKitService, AttestationService, AnswerAnalysisService],
  controllers: [ProctorController, AdminProctorController],
})
class ProctoringModule {}

/** Coin wallet: top-ups, earned coins, rewards catalog and redemptions. */
@Module({ imports: [CompetitionModule], controllers: [WalletController, AdminWalletController] })
class WalletModule {}

@Module({ controllers: [AuthController, MeController], providers: [AuthService, FirebaseVerifier] })
class IdentityModule {}

@Module({ controllers: [AdminAuthController, AdminController, AdminConfigController, PublicConfigController] })
class AdminModule {}

@Module({ controllers: [CatalogController, AdminTaxonomyController, AdminQuestionsController], providers: [QuestionsService, ImportService] })
class ContentModule {}

@Module({ imports: [CompetitionModule], controllers: [TournamentsController, AdminTournamentsController], providers: [TournamentsService], exports: [TournamentsService] })
class TournamentsModule {}

@Module({ imports: [TournamentsModule, CompetitionModule], controllers: [HomeController, AdminCmsController] })
class CmsModule {}

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Shared counters across instances when Redis is configured.
      ...(process.env.REDIS_URL && {
        storage: new ResilientThrottlerStorage(
          new ThrottlerStorageRedisService(new Redis(process.env.REDIS_URL, { keyPrefix: 'throttle:', maxRetriesPerRequest: 1, commandTimeout: 500, connectTimeout: 2000, retryStrategy: (times) => Math.min(times * 200, 2000) })),
        ),
      }),
    }),
    CoreModule,
    CompetitionModule,
    NotificationsModule,
    DuelsModule,
    WalletModule,
    ProctoringModule,
    IdentityModule,
    AdminModule,
    ContentModule,
    TournamentsModule,
    CmsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
