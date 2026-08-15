-- DropIndex
DROP INDEX "WatchProgress_userId_episodeId_key";

-- CreateIndex
CREATE INDEX "WatchProgress_userId_episodeId_idx" ON "WatchProgress"("userId", "episodeId");

-- CreateIndex
CREATE INDEX "WatchProgress_userId_watchedAt_idx" ON "WatchProgress"("userId", "watchedAt");
