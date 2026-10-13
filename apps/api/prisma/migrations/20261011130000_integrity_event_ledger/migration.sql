ALTER TABLE "AttemptEvent"
  ADD COLUMN "clientSessionId" TEXT,
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "clientAt" TIMESTAMP(3),
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "appVersion" TEXT,
  ADD COLUMN "osVersion" TEXT,
  ADD COLUMN "deviceModel" TEXT,
  ADD COLUMN "riskPoints" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AttemptEvent_attemptId_at_idx" ON "AttemptEvent"("attemptId", "at");
CREATE UNIQUE INDEX "AttemptEvent_attemptId_clientSessionId_eventId_key"
  ON "AttemptEvent"("attemptId", "clientSessionId", "eventId");
CREATE UNIQUE INDEX "AttemptEvent_attemptId_clientSessionId_sequence_key"
  ON "AttemptEvent"("attemptId", "clientSessionId", "sequence");
