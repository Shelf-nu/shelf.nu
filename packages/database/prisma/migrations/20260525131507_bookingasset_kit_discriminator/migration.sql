-- Phase 4b-Polish-6 — `BookingAsset.assetKitId` discriminator
--
-- Third application of the kit-driven-vs-standalone discriminator pattern,
-- mirroring `Custody.kitCustodyId` (Phase 2) and `AssetLocation.assetKitId`
-- (Phase 4b-Polish-4). Distinguishes a booking slice that came from a kit
-- ("Kittington holds 87 Gloves on this booking") from a slice booked
-- directly from the asset's free pool ("22 standalone Gloves on this
-- booking"). Required so multi-kit qty-tracked assets can be booked
-- partially-standalone without the booking UI mis-attributing the
-- standalone slice to a kit it doesn't belong to.
--
-- Cascade semantics on AssetKit delete: `ON DELETE SET NULL`. Different
-- from AssetLocation (`CASCADE`) because silently shrinking an in-flight
-- booking when an asset is removed from a kit is dangerous — instead the
-- booked slice converts to a standalone reservation and the service
-- layer emits a system note + audit event so the user sees the change.

-- 1. Add the nullable FK column + index. Constraint added separately so
--    the column exists before the FK references it (for clarity).
ALTER TABLE "BookingAsset" ADD COLUMN "assetKitId" TEXT;

ALTER TABLE "BookingAsset"
  ADD CONSTRAINT "BookingAsset_assetKitId_fkey"
  FOREIGN KEY ("assetKitId") REFERENCES "AssetKit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BookingAsset_assetKitId_idx" ON "BookingAsset"("assetKitId");

-- 2. Backfill — attribute existing BookingAsset rows to a kit when the
--    booking clearly held the *whole* kit at booking time.
--
--    Heuristic (matches the diagnostic queries shared with the user):
--      a) BookingAsset.asset is in some AssetKit AK (asset-in-a-kit candidate)
--      b) BookingAsset.quantity = AK.quantity (qty matches the slice)
--      c) The booking holds matching rows for EVERY AssetKit of AK.kit
--         at the corresponding slice qty (the whole kit was added)
--      d) Exactly ONE such kit matches (no multi-kit ambiguity)
--
--    For prod data, (b) is trivially true for INDIVIDUAL-in-kit rows (both
--    sides are 1) and for any AssetKit/BookingAsset rows seeded from the
--    pre-Phase-4 1:1 `Asset.kitId` (everything backfilled at qty=1). The
--    interesting selection is (c) — distinguishes "user added the kit"
--    from "user added a few of the kit's assets standalone".
--
--    Production diagnostic (run 2026-05-25):
--      175k total BookingAsset rows
--      74,370 in-kit candidates (42%)
--      64,505 would-backfill to kit-driven (87% of candidates)
--      9,865 stay standalone (13% of candidates) — mostly genuine
--        standalone adds, ~1,559 from partial-kit-in-booking pairs.
WITH candidates AS (
  SELECT ba.id AS ba_id, ba."bookingId", ba."assetId", ba.quantity AS ba_qty,
         ak.id AS ak_id, ak."kitId", ak.quantity AS ak_qty
  FROM "BookingAsset" ba
  JOIN "AssetKit" ak ON ak."assetId" = ba."assetId"
  WHERE ba.quantity = ak.quantity
),
kit_coverage AS (
  -- For each (BookingAsset, candidate kit), check that the booking
  -- contains matching BookingAsset rows for every AssetKit of the kit
  -- at the corresponding slice quantity.
  SELECT c.ba_id, c.ak_id, c."bookingId", c."kitId",
    (SELECT COUNT(*) FROM "AssetKit" ak2 WHERE ak2."kitId" = c."kitId") AS kit_size,
    (SELECT COUNT(*) FROM "AssetKit" ak2
     WHERE ak2."kitId" = c."kitId"
       AND EXISTS (
         SELECT 1 FROM "BookingAsset" ba2
         WHERE ba2."bookingId" = c."bookingId"
           AND ba2."assetId" = ak2."assetId"
           AND ba2.quantity = ak2.quantity
       )
    ) AS matched_count
  FROM candidates c
),
matches AS (
  SELECT ba_id, ak_id, "bookingId"
  FROM kit_coverage
  WHERE kit_size = matched_count AND kit_size > 0
),
unique_matches AS (
  -- Confident attribution only when exactly one kit matches.
  -- (Multi-kit qty-tracked rows where multiple kits' compositions
  -- happen to collide → leave NULL, let the service layer + UI handle.)
  SELECT ba_id, MIN(ak_id) AS ak_id
  FROM matches
  GROUP BY ba_id
  HAVING COUNT(DISTINCT ak_id) = 1
)
UPDATE "BookingAsset"
SET "assetKitId" = um.ak_id
FROM unique_matches um
WHERE "BookingAsset".id = um.ba_id;

-- 3. Drop the legacy composite unique. Replaced by two partial uniques
--    that allow one standalone + N kit-driven rows for the same
--    (booking, asset).
ALTER TABLE "BookingAsset" DROP CONSTRAINT "BookingAsset_bookingId_assetId_key";

-- 4. Partial uniques (Postgres-only — Prisma can't express WHERE clauses
--    on @@unique, so they live in migration SQL).
--
--    manual_unique: at most one standalone row per (booking, asset).
--      Prevents duplicate manual entries when a user re-scans the same
--      asset into a booking they already booked it into standalone.
--
--    kit_unique:    at most one kit-driven row per (booking, assetKit).
--      An AssetKit uniquely identifies (asset, kit), so this prevents
--      duplicate kit-driven rows for the same kit slice in a booking.
CREATE UNIQUE INDEX "BookingAsset_manual_unique"
  ON "BookingAsset"("bookingId", "assetId")
  WHERE "assetKitId" IS NULL;

CREATE UNIQUE INDEX "BookingAsset_kit_unique"
  ON "BookingAsset"("bookingId", "assetKitId")
  WHERE "assetKitId" IS NOT NULL;
