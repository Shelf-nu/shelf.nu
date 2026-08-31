-- Records HOW MANY of each booking slice's units have been sent out.
--
-- `checkedOutAt` says only WHETHER any left. A QUANTITY_TRACKED slice goes out
-- a few units at a time, so a reader sizing an obligation from the timestamp
-- has to guess, and both guesses are wrong: the full booked quantity demands
-- back units that never moved and the booking can never complete, zero strands
-- the units that did leave.
--
-- Cumulative units dispatched, never decremented. What is still out is
-- `checkedOutQuantity` minus the `ConsumptionLog` dispositions, matching the
-- `bookedQuantity` / `checkedOutQuantity` / `dispositionedQuantity` counters the
-- booking surfaces already read.
--
-- Additive: one NOT NULL column with a 0 default, and no index. Nothing reads
-- it yet.

ALTER TABLE "BookingAsset"
  ADD COLUMN IF NOT EXISTS "checkedOutQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill 1 — everything the progressive sessions recorded.
--
-- Assigns rather than accumulates, so re-running this file is a no-op instead
-- of doubling every slice. A doubled count reads as units that were never
-- booked, and an obligation larger than the booking can ever satisfy is one
-- nobody can clear from the UI.
--
-- TAGGED claims name their slice outright. `assetIds` / `quantities` /
-- `bookingAssetIds` are positionally aligned, so zipping them recovers both
-- which slice a claim belonged to and how many units it took. Summed rather
-- than DISTINCT ON: the marker only needed the earliest session, a count needs
-- every one of them.
--
-- UNTAGGED claims name no slice, so their units are known per asset only. They
-- are laid down in the order every read site fills an untagged claim
-- (`compareSlicesForGreedyFill`): standalone slices before kit-driven ones,
-- then by id. Each slice takes what is left after the ones ahead of it, capped
-- at its own booked quantity, so the spread can never exceed what was claimed.
-- Sizing them any other way would describe a slice differently from what the
-- booking's own screens report for it.
--
-- `COALESCE(qty, 1)` covers rows written before `quantities` existed, where the
-- array is empty and unnest pads with NULL — one unit per entry, the same
-- reading the runtime parser applies.
WITH tagged AS (
  SELECT t."bookingAssetId" AS slice_id, SUM(COALESCE(t.qty, 1))::int AS units
  FROM "PartialBookingCheckout" pco,
       unnest(pco."assetIds", pco."quantities", pco."bookingAssetIds")
         AS t("assetId", qty, "bookingAssetId")
  WHERE t."bookingAssetId" IS NOT NULL
    AND t."bookingAssetId" <> ''
  GROUP BY t."bookingAssetId"
),
untagged_total AS (
  SELECT pco."bookingId", t."assetId", SUM(COALESCE(t.qty, 1))::int AS total
  FROM "PartialBookingCheckout" pco,
       unnest(pco."assetIds", pco."quantities", pco."bookingAssetIds")
         AS t("assetId", qty, "bookingAssetId")
  WHERE t."bookingAssetId" IS NULL
     OR t."bookingAssetId" = ''
  GROUP BY pco."bookingId", t."assetId"
),
greedy AS (
  SELECT ba2.id, ba2."bookingId", ba2."assetId", ba2.quantity,
         COALESCE(
           SUM(ba2.quantity) OVER (
             PARTITION BY ba2."bookingId", ba2."assetId"
             ORDER BY (ba2."assetKitId" IS NOT NULL), ba2.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0
         )::int AS prior
  FROM "BookingAsset" ba2
),
untagged_share AS (
  SELECT g.id, LEAST(g.quantity, GREATEST(0, u.total - g.prior))::int AS units
  FROM greedy g
  JOIN untagged_total u
    ON u."bookingId" = g."bookingId"
   AND u."assetId"   = g."assetId"
),
sized AS (
  SELECT g.id,
         COALESCE(tg.units, 0) + COALESCE(us.units, 0) AS units
  FROM greedy g
  LEFT JOIN tagged tg        ON tg.slice_id = g.id
  LEFT JOIN untagged_share us ON us.id      = g.id
)
UPDATE "BookingAsset" ba
SET "checkedOutQuantity" = sized.units
FROM sized
WHERE ba.id = sized.id
  AND ba."checkedOutQuantity" IS DISTINCT FROM sized.units;

-- Backfill 3 — slices that went out without any session naming them.
--
-- The all-at-once checkout and the kit-member propagation both send a WHOLE
-- slice out and record only the marker, so a marked slice no session accounts
-- for left in full. Fenced on `checkedOutQuantity = 0` so it cannot double-count
-- a slice backfill 1 or 2 already sized, and on `checkedOutAt` so it never
-- invents a departure for a slice that stayed on the shelf.
UPDATE "BookingAsset" ba
SET "checkedOutQuantity" = ba.quantity
WHERE ba."checkedOutAt" IS NOT NULL
  AND ba."checkedOutQuantity" = 0;
