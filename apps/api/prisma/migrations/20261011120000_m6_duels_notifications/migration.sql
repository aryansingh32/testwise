-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('FCM', 'APNS');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED', 'INVALID_TOKEN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DuelStatus" AS ENUM ('WAITING', 'ACTIVE', 'FINISHED', 'CANCELLED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "DuelMode" AS ENUM ('RANKED', 'FRIEND');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'ACCOUNT',
ADD COLUMN     "data" JSONB,
ADD COLUMN     "eventKey" TEXT,
ADD COLUMN     "inbox" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "NotificationRead" ADD COLUMN     "openedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "duelDraws" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duelLosses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duelRating" INTEGER NOT NULL DEFAULT 1200,
ADD COLUMN     "duelStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duelWins" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "locale" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "key" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyHi" TEXT NOT NULL,
    "push" BOOLEAN NOT NULL,
    "inbox" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "push" BOOLEAN NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("userId","category")
);

-- CreateTable
CREATE TABLE "PushOutbox" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "userId" TEXT,
    "tournamentId" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cursor" TEXT,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PushOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDelivery" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "deviceId" TEXT,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyHi" TEXT,
    "link" TEXT,
    "push" BOOLEAN NOT NULL,
    "inbox" BOOLEAN NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BotPersona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "color" TEXT NOT NULL DEFAULT '#8B5CF6',
    "ratingMin" INTEGER NOT NULL,
    "ratingMax" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duel" (
    "id" TEXT NOT NULL,
    "mode" "DuelMode" NOT NULL DEFAULT 'RANKED',
    "status" "DuelStatus" NOT NULL DEFAULT 'WAITING',
    "examId" TEXT,
    "inviteCode" TEXT,
    "playerAId" TEXT NOT NULL,
    "playerBId" TEXT,
    "botPersonaId" TEXT,
    "botRating" INTEGER,
    "paper" JSONB,
    "questionCount" INTEGER NOT NULL,
    "secondsPerQuestion" INTEGER NOT NULL,
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "winner" TEXT,
    "ratingABefore" INTEGER,
    "ratingAAfter" INTEGER,
    "ratingBBefore" INTEGER,
    "ratingBAfter" INTEGER,
    "rematchOfId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuelAnswer" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "selectedLabels" TEXT[],
    "isCorrect" BOOLEAN NOT NULL,
    "timeMs" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_active_idx" ON "PushDevice"("userId", "active");

-- CreateIndex
CREATE INDEX "PushOutbox_status_nextAttemptAt_idx" ON "PushOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PushDelivery_outboxId_idx" ON "PushDelivery"("outboxId");

-- CreateIndex
CREATE INDEX "PushDelivery_createdAt_idx" ON "PushDelivery"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_sendAt_idx" ON "NotificationCampaign"("status", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "Duel_inviteCode_key" ON "Duel"("inviteCode");

-- CreateIndex
CREATE INDEX "Duel_playerAId_createdAt_idx" ON "Duel"("playerAId", "createdAt");

-- CreateIndex
CREATE INDEX "Duel_playerBId_createdAt_idx" ON "Duel"("playerBId", "createdAt");

-- CreateIndex
CREATE INDEX "Duel_status_idx" ON "Duel"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DuelAnswer_duelId_side_questionIndex_key" ON "DuelAnswer"("duelId", "side", "questionIndex");

-- CreateIndex
CREATE INDEX "Notification_campaignId_idx" ON "Notification"("campaignId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushOutbox" ADD CONSTRAINT "PushOutbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "PushOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDelivery" ADD CONSTRAINT "PushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duel" ADD CONSTRAINT "Duel_botPersonaId_fkey" FOREIGN KEY ("botPersonaId") REFERENCES "BotPersona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuelAnswer" ADD CONSTRAINT "DuelAnswer_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "Duel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "Notification" ADD COLUMN "batchId" TEXT;
CREATE INDEX "Notification_batchId_idx" ON "Notification"("batchId");
ALTER TABLE "PushOutbox" ADD COLUMN "userIds" TEXT[];
