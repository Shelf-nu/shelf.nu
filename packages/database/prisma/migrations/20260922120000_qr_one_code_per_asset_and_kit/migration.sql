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
-- Atomicity: `prisma migrate deploy` does NOT wrap a migration in a transaction.
-- The schema engine's own architecture notes say so and name the remedy — "users
-- have the option to add a BEGIN; and a COMMIT; to the migrations they want
-- wrapped" — so the two builds are wrapped explicitly here. Without it, a
-- duplicate in "kitId" would leave the "assetId" index committed and the
-- migration failed, a half-applied state someone then has to unpick by hand.
--
-- `IF NOT EXISTS` stays on top of that, so a retry is safe even if one index
-- somehow exists already (a hand-run statement, a resolve gone sideways).
--
-- Locking: plain (non-CONCURRENT) CREATE UNIQUE INDEX — CONCURRENTLY cannot run
-- inside a transaction, which the BEGIN above now guarantees there is one, and
-- the repo has no precedent for it either. "Qr" is one row per asset plus the
-- unclaimed batches, so it is among the larger tables here; the builds hold a
-- brief write lock on it, which blocks code creation and relinking — not reads,
-- and not scanning.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS "Qr_assetId_unique_when_linked" ON "Qr"("assetId")
  WHERE "assetId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Qr_kitId_unique_when_linked" ON "Qr"("kitId")
  WHERE "kitId" IS NOT NULL;

COMMIT;
