-- AlterTable
ALTER TABLE "ProctorSession" ADD COLUMN "liveRoom" TEXT,
ADD COLUMN "consent" JSONB,
ADD COLUMN "network" JSONB;
ALTER TABLE "ProctorSession" ADD COLUMN "features" JSONB;
ALTER TABLE "Test" ADD COLUMN "proctorOptions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Tournament" ADD COLUMN "proctorOptions" JSONB NOT NULL DEFAULT '{}';
