-- AlterTable
ALTER TABLE "ProctorSession" ADD COLUMN "attestation" JSONB,
ADD COLUMN "attestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AttestedKey" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttestedKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannedDevice" (
    "id" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "adminId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "BannedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttestedKey_keyId_key" ON "AttestedKey"("keyId");
CREATE INDEX "AttestedKey_userId_idx" ON "AttestedKey"("userId");
CREATE UNIQUE INDEX "BannedDevice_deviceHash_key" ON "BannedDevice"("deviceHash");
CREATE INDEX "BannedDevice_userId_idx" ON "BannedDevice"("userId");

-- AddForeignKey
ALTER TABLE "AttestedKey" ADD CONSTRAINT "AttestedKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum (separate statements; Postgres cannot use a new enum value in the same transaction that adds it)
ALTER TYPE "ProctorActionType" ADD VALUE IF NOT EXISTS 'DISQUALIFY';
ALTER TYPE "ProctorActionType" ADD VALUE IF NOT EXISTS 'DEVICE_BAN';
