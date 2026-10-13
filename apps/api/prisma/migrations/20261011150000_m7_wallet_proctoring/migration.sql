-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('TOPUP', 'TOPUP_REFUND', 'EARN_PRIZE', 'EARN_DUEL', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'REDEEM_HOLD', 'REDEEM_RELEASE', 'REDEEM_SETTLE');

-- CreateEnum
CREATE TYPE "RewardKind" AS ENUM ('MERCH', 'VOUCHER', 'UPI_CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'APPROVED', 'FULFILLED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProctorMode" AS ENUM ('OFF', 'BASIC', 'AI', 'LIVE');

-- CreateEnum
CREATE TYPE "ProctorSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "FlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ProctorActionType" AS ENUM ('WARN', 'TERMINATE', 'BLOCK', 'LIVE_VIEW', 'LIVE_END', 'FLAG_CONFIRMED', 'FLAG_DISMISSED', 'NOTE');

-- AlterEnum
ALTER TYPE "OrderKind" ADD VALUE 'COIN_TOPUP';

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "proctorMode" "ProctorMode" NOT NULL DEFAULT 'OFF';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "proctorMode" "ProctorMode" NOT NULL DEFAULT 'OFF';

-- CreateTable
CREATE TABLE "Wallet" (
    "userId" TEXT NOT NULL,
    "purchased" INTEGER NOT NULL DEFAULT 0,
    "earned" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "lifetimePurchased" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WalletTxn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "purchasedDelta" INTEGER NOT NULL DEFAULT 0,
    "earnedDelta" INTEGER NOT NULL DEFAULT 0,
    "heldDelta" INTEGER NOT NULL DEFAULT 0,
    "purchasedAfter" INTEGER NOT NULL,
    "earnedAfter" INTEGER NOT NULL,
    "heldAfter" INTEGER NOT NULL,
    "memo" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actorId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinPack" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT,
    "coins" INTEGER NOT NULL,
    "bonusCoins" INTEGER NOT NULL DEFAULT 0,
    "pricePaise" INTEGER NOT NULL,
    "badgeEn" TEXT,
    "badgeHi" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardItem" (
    "id" TEXT NOT NULL,
    "kind" "RewardKind" NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT,
    "descriptionEn" TEXT,
    "descriptionHi" TEXT,
    "termsEn" TEXT,
    "termsHi" TEXT,
    "imageUrl" TEXT,
    "brand" TEXT,
    "coinCost" INTEGER NOT NULL,
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "variants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stock" INTEGER,
    "perUserLimit" INTEGER,
    "requiresAddress" BOOLEAN NOT NULL DEFAULT false,
    "allowPurchasedCoins" BOOLEAN NOT NULL DEFAULT true,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherCode" (
    "id" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pin" TEXT,
    "expiresAt" TIMESTAMP(3),
    "redemptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "fromPurchased" INTEGER NOT NULL,
    "fromEarned" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "variant" TEXT,
    "shippingAddress" JSONB,
    "upiVpa" TEXT,
    "voucherCode" TEXT,
    "voucherPin" TEXT,
    "payoutRef" TEXT,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "adminNote" TEXT,
    "rejectReason" TEXT,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorSession" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT,
    "testId" TEXT NOT NULL,
    "mode" "ProctorMode" NOT NULL,
    "status" "ProctorSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "device" JSONB,
    "integrity" JSONB,
    "deviceId" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "appState" TEXT,
    "questionIndex" INTEGER,
    "answered" INTEGER NOT NULL DEFAULT 0,
    "faces" INTEGER,
    "snapshotKey" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "liveRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProctorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorFlag" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT,
    "type" TEXT NOT NULL,
    "severity" "FlagSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorAction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ProctorActionType" NOT NULL,
    "actor" TEXT NOT NULL,
    "adminId" TEXT,
    "flagId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorSnapshot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "faces" INTEGER,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTxn_idempotencyKey_key" ON "WalletTxn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTxn_userId_createdAt_idx" ON "WalletTxn"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTxn_refType_refId_idx" ON "WalletTxn"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherCode_redemptionId_key" ON "VoucherCode"("redemptionId");

-- CreateIndex
CREATE INDEX "VoucherCode_rewardId_redemptionId_idx" ON "VoucherCode"("rewardId", "redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherCode_rewardId_code_key" ON "VoucherCode"("rewardId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_idempotencyKey_key" ON "Redemption"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Redemption_status_createdAt_idx" ON "Redemption"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Redemption_userId_createdAt_idx" ON "Redemption"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProctorSession_attemptId_key" ON "ProctorSession"("attemptId");

-- CreateIndex
CREATE INDEX "ProctorSession_tournamentId_status_idx" ON "ProctorSession"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "ProctorSession_status_lastSeenAt_idx" ON "ProctorSession"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ProctorSession_userId_idx" ON "ProctorSession"("userId");

-- CreateIndex
CREATE INDEX "ProctorFlag_status_severity_createdAt_idx" ON "ProctorFlag"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "ProctorFlag_sessionId_createdAt_idx" ON "ProctorFlag"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProctorFlag_tournamentId_status_idx" ON "ProctorFlag"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "ProctorAction_sessionId_createdAt_idx" ON "ProctorAction"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProctorSnapshot_sessionId_takenAt_idx" ON "ProctorSnapshot"("sessionId", "takenAt");

-- CreateIndex
CREATE INDEX "ProctorSnapshot_takenAt_idx" ON "ProctorSnapshot"("takenAt");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTxn" ADD CONSTRAINT "WalletTxn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherCode" ADD CONSTRAINT "VoucherCode_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "RewardItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "RewardItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSession" ADD CONSTRAINT "ProctorSession_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSession" ADD CONSTRAINT "ProctorSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorFlag" ADD CONSTRAINT "ProctorFlag_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorAction" ADD CONSTRAINT "ProctorAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSnapshot" ADD CONSTRAINT "ProctorSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProctorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Coin balances can never go negative, whatever the application does.
ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_non_negative" CHECK ("purchased" >= 0 AND "earned" >= 0 AND "held" >= 0);
ALTER TABLE "Redemption" ADD CONSTRAINT "redemption_split" CHECK ("coins" = "fromPurchased" + "fromEarned" AND "fromPurchased" >= 0 AND "fromEarned" >= 0);

-- Coin movements are append-only, like the money ledger.
CREATE TRIGGER wallet_txn_append_only
  BEFORE UPDATE OR DELETE ON "WalletTxn"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
