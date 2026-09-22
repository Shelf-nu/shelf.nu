-- One QR code per asset, and one per kit.
--
-- The application has always assumed this — `kit.qrCodes[0]`, `asset.qrCodes[0]`
-- and every relink guard read the single code — but nothing enforced it. A plain
-- unique constraint cannot: both columns are nullable and non-unique on purpose,
-- because an unclaimed printed code has neither an asset nor a kit, and there are
-- many of those at once. A partial unique index says "at most one row per
-- non-null value" and leaves the unclaimed pool alone.
--
-- The code path that could create a second one (a check-then-create in
-- `generateQrObj`) now takes a row lock and re-reads, so these indexes are the
-- backstop rather than the only guard.
--
-- PRECONDITION: each statement fails if that column already has a duplicate.
-- Check before deploying — both must return no rows:
--
--   SELECT "assetId", COUNT(*) FROM "Qr"
--    WHERE "assetId" IS NOT NULL GROUP BY "assetId" HAVING COUNT(*) > 1;
--   SELECT "kitId", COUNT(*) FROM "Qr"
--    WHERE "kitId" IS NOT NULL GROUP BY "kitId" HAVING COUNT(*) > 1;
--
-- If either returns rows, decide which code to keep (the one on the printed
-- label) and null the loser's "assetId"/"kitId" first — that returns it to the
-- unclaimed pool rather than deleting a code someone may be holding.
--
-- Recovery: `prisma migrate deploy` does NOT wrap a migration in a transaction,
-- so a failure on the second statement leaves the first index in place. Both are
-- therefore `IF NOT EXISTS`, which is what Prisma's own guidance recommends for
-- re-runnable steps — fix the duplicate data, then redeploy, and the index that
-- already exists is skipped instead of failing the migration a second time.
--
-- Locking: plain (non-CONCURRENT) CREATE UNIQUE INDEX. CREATE INDEX
-- CONCURRENTLY cannot run inside a migration that may already be in a
-- transaction, and the repo has no precedent for it. "Qr" is one row per asset
-- plus the unclaimed batches, so it is among the larger tables here; each build
-- holds a brief write lock on it, which blocks code creation and relinking — not
-- reads, and not scanning.
CREATE UNIQUE INDEX IF NOT EXISTS "Qr_assetId_unique_when_linked" ON "Qr"("assetId")
  WHERE "assetId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Qr_kitId_unique_when_linked" ON "Qr"("kitId")
  WHERE "kitId" IS NOT NULL;
