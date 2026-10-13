-- AlterEnum
ALTER TYPE "DuelMode" ADD VALUE IF NOT EXISTS 'PAID';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'DUEL_ENTRY';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'DUEL_REFUND';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'DUEL_PRIZE';
ALTER TYPE "WalletTxnType" ADD VALUE IF NOT EXISTS 'GAME_REWARD';

-- CreateEnum
CREATE TYPE "DuelOfferStatus" AS ENUM ('DRAFT', 'LIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "DuelRoomStatus" AS ENUM ('OPEN', 'WAITING', 'MATCHED', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DuelOffer" (
    "id" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleHi" TEXT,
    "examId" TEXT,
    "entryCoins" INTEGER NOT NULL,
    "prizeCoins" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "secondsPerQuestion" INTEGER NOT NULL,
    "status" "DuelOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DuelOffer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "duel_offer_prize_within_pool" CHECK ("entryCoins" > 0 AND "prizeCoins" >= 0 AND "prizeCoins" <= "entryCoins" * 2)
);

CREATE TABLE "DuelRoom" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "DuelRoomStatus" NOT NULL DEFAULT 'OPEN',
    "entryCoins" INTEGER NOT NULL,
    "prizeCoins" INTEGER NOT NULL,
    "playerAId" TEXT,
    "playerBId" TEXT,
    "duelId" TEXT,
    "winnerId" TEXT,
    "waitingUntil" TIMESTAMP(3),
    "readyBy" TIMESTAMP(3),
    "matchedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DuelRoom_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "duel_room_prize_within_pool" CHECK ("prizeCoins" <= "entryCoins" * 2)
);

-- CreateIndex
CREATE INDEX "DuelOffer_status_idx" ON "DuelOffer"("status");
CREATE UNIQUE INDEX "DuelRoom_duelId_key" ON "DuelRoom"("duelId");
CREATE UNIQUE INDEX "DuelRoom_offerId_seq_key" ON "DuelRoom"("offerId", "seq");
CREATE INDEX "DuelRoom_offerId_status_idx" ON "DuelRoom"("offerId", "status");
CREATE INDEX "DuelRoom_playerAId_idx" ON "DuelRoom"("playerAId");
CREATE INDEX "DuelRoom_playerBId_idx" ON "DuelRoom"("playerBId");
CREATE INDEX "DuelRoom_status_waitingUntil_idx" ON "DuelRoom"("status", "waitingUntil");

-- AddForeignKey
ALTER TABLE "DuelRoom" ADD CONSTRAINT "DuelRoom_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "DuelOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
