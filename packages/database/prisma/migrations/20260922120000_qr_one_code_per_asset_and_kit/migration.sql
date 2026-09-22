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
-- `generateQrObj`) now takes a row lock and re-reads, so this index is the
-- backstop rather than the only guard.
--
-- PRECONDITION: this fails if any asset or kit already holds two codes. Check
-- before deploying:
--
--   SELECT "assetId", COUNT(*) FROM "Qr"
--    WHERE "assetId" IS NOT NULL GROUP BY "assetId" HAVING COUNT(*) > 1;
--   SELECT "kitId", COUNT(*) FROM "Qr"
--    WHERE "kitId" IS NOT NULL GROUP BY "kitId" HAVING COUNT(*) > 1;
--
-- Both must return no rows. If either does, decide which code to keep (the one
-- on the printed label) and null the loser's "assetId"/"kitId" first — that
-- returns it to the unclaimed pool rather than deleting a code someone may hold.
-- A failure here is safe, not partial: Prisma runs each migration in a
-- transaction, so the deploy aborts with the offending value named and nothing
-- is applied.
--
-- Locking: plain (non-CONCURRENT) CREATE UNIQUE INDEX, matching repo
-- convention — CREATE INDEX CONCURRENTLY cannot run inside Prisma's migration
-- transaction. "Qr" is one row per asset plus the unclaimed batches, so it is
-- among the larger tables here; the build holds a brief write lock on it, which
-- blocks code creation and relinking (not reads or scans) while it runs.
CREATE UNIQUE INDEX "Qr_assetId_unique_when_linked" ON "Qr"("assetId")
  WHERE "assetId" IS NOT NULL;

CREATE UNIQUE INDEX "Qr_kitId_unique_when_linked" ON "Qr"("kitId")
  WHERE "kitId" IS NOT NULL;
