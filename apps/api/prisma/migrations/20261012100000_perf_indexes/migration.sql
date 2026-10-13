-- Leaderboard: ORDER BY xp DESC, createdAt ASC
CREATE INDEX "User_xp_createdAt_idx" ON "User"("xp" DESC, "createdAt");
-- practiceAccess(): series containing a given test (PK leads with seriesId)
CREATE INDEX "SeriesTest_testId_idx" ON "SeriesTest"("testId");
-- A student's registrations (notification visibility, "my tournaments")
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");
-- Attempt count per student per test (attempt limit check)
CREATE INDEX "Attempt_userId_testId_idx" ON "Attempt"("userId", "testId");
-- revokeAll() and cascading deletes by owner
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_adminId_idx" ON "RefreshToken"("adminId");
