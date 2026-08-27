-- Records whether each booking slice is checked out, and by whom.
--
-- Nothing could answer "was THIS asset checked out on THIS booking?" before:
--   - `Asset.status` is global — an asset may be CHECKED_OUT by a DIFFERENT
--     active booking while never having gone out on this one.
--   - `PartialBookingCheckout` records progressive scan SESSIONS. The
--     all-at-once checkout writes none, so absence of rows proved nothing.
--
-- The check-in guard used "does this booking have any checkout rows?" as a
-- stand-in. That holds only while a booking is purely one style or the other:
-- a booking checked out with the button (no rows) that later has ONE asset
-- added and scanned out gains its first row, and every button-checked-out asset
-- on it is then reported as never checked out. Booking
-- cmt4klqh400pfrbi8vm966180 hit this with 105 of 107 slices refused.
--
-- Additive and reversible: four nullable columns. The user columns are plain
-- TEXT with no FK, matching `assetKitId` / `sourceKitId` / `bookingModelRequestId`
-- on this table — a Prisma relation here pushes the extended client's generics
-- past TS's recursion limit (TS2321), because `Booking` is a hub model.

ALTER TABLE "BookingAsset"
  ADD COLUMN IF NOT EXISTS "checkedOutAt"   TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "checkedOutById" TEXT,
  ADD COLUMN IF NOT EXISTS "checkedInAt"    TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "checkedInById"  TEXT;

-- Backfill 1a — progressive checkouts that name their exact slice.
-- `assetIds` / `bookingAssetIds` are positionally aligned, so zipping them
-- recovers which slice each claim belonged to. Slice-exact matters because one
-- (booking, asset) can hold a standalone row plus N kit-driven rows: matching
-- on `assetId` alone would stamp siblings the session never touched, which is
-- the same over-stamping the runtime writer avoids.
-- Earliest session wins, matching `getDetailedPartialCheckoutData`.
UPDATE "BookingAsset" ba
SET "checkedOutAt"   = src."checkoutTimestamp",
    "checkedOutById" = src."checkedOutById"
FROM (
  SELECT DISTINCT ON (t."bookingAssetId")
         t."bookingAssetId", pco."checkoutTimestamp", pco."checkedOutById"
  FROM "PartialBookingCheckout" pco,
       unnest(pco."assetIds", pco."bookingAssetIds") AS t("assetId", "bookingAssetId")
  WHERE t."bookingAssetId" IS NOT NULL
    AND t."bookingAssetId" <> ''
  ORDER BY t."bookingAssetId", pco."checkoutTimestamp" ASC
) src
WHERE ba.id = src."bookingAssetId"
  AND ba."checkedOutAt" IS NULL;

-- Backfill 1b — untagged claims: sessions written before `bookingAssetIds`
-- existed, and INDIVIDUAL / legacy dispositions which carry `''`. These name
-- no slice, so asset-level greedy attribution is all the data supports — the
-- same fallback the runtime writer applies to untagged entries. Runs second so
-- it only fills slices 1a could not resolve exactly.
UPDATE "BookingAsset" ba
SET "checkedOutAt"   = src."checkoutTimestamp",
    "checkedOutById" = src."checkedOutById"
FROM (
  SELECT DISTINCT ON (pco."bookingId", t."assetId")
         pco."bookingId", t."assetId",
         pco."checkoutTimestamp", pco."checkedOutById"
  FROM "PartialBookingCheckout" pco,
       unnest(pco."assetIds", pco."bookingAssetIds") AS t("assetId", "bookingAssetId")
  WHERE t."bookingAssetId" IS NULL
     OR t."bookingAssetId" = ''
  ORDER BY pco."bookingId", t."assetId", pco."checkoutTimestamp" ASC
) src
WHERE ba."bookingId" = src."bookingId"
  AND ba."assetId"   = src."assetId"
  AND ba."checkedOutAt" IS NULL;

-- Backfill 2a — all-at-once checkouts, reconstructed per asset from the
-- activity trail. `checkoutBooking` emits one BOOKING_CHECKED_OUT event per
-- asset while the progressive path emits BOOKING_PARTIAL_CHECKOUT, so these
-- rows name exactly the population that left no session row — and they carry a
-- truer instant than `Booking.updatedAt`, which any later edit moves.
--
-- This is what repairs a MIXED booking: one checked out with the button and
-- later given an asset that was scanned out. Backfill 1 stamps only the scanned
-- asset, and a booking-wide "has no session rows" test would skip the rest
-- entirely, leaving them refused by the very guard this migration exists to
-- feed. Matching per asset instead cannot over-stamp a progressive-only
-- booking, because those emit a different action.
UPDATE "BookingAsset" ba
SET "checkedOutAt"   = src."occurredAt",
    "checkedOutById" = src."actorUserId"
FROM (
  SELECT DISTINCT ON (ae."bookingId", ae."assetId")
         ae."bookingId", ae."assetId", ae."occurredAt", ae."actorUserId"
  FROM "ActivityEvent" ae
  WHERE ae.action = 'BOOKING_CHECKED_OUT'
    AND ae."bookingId" IS NOT NULL
    AND ae."assetId" IS NOT NULL
  ORDER BY ae."bookingId", ae."assetId", ae."occurredAt" ASC
) src
WHERE ba."bookingId" = src."bookingId"
  AND ba."assetId"   = src."assetId"
  AND ba."checkedOutAt" IS NULL;

-- Backfill 2b — bookings predating the ActivityEvent model, which have no
-- per-asset trail to reconstruct from. Restricted to bookings carrying NO
-- session rows, so it cannot disturb a mixed booking 2a already repaired.
-- `Booking.updatedAt` is the only remaining stand-in for the checkout moment.
--
-- Reservations archived straight from RESERVED never went out, so they get no
-- checkout marker: `archivedWithoutCheckin` is the flag that says so, and the
-- reports already exclude those bookings from return behaviour for the same
-- reason. Stamping them here would fabricate an entire movement history, since
-- Backfill 4 would then mark them returned as well.
UPDATE "BookingAsset" ba
SET "checkedOutAt" = b."updatedAt"
FROM "Booking" b
WHERE ba."bookingId" = b.id
  AND ba."checkedOutAt" IS NULL
  AND b.status IN ('ONGOING', 'OVERDUE', 'COMPLETE', 'ARCHIVED')
  AND b."archivedWithoutCheckin" = false
  AND NOT EXISTS (
    SELECT 1 FROM "PartialBookingCheckout" p WHERE p."bookingId" = b.id
  );

-- Backfill 3 — progressive check-ins, mirroring backfill 1.
UPDATE "BookingAsset" ba
SET "checkedInAt"   = src."checkinTimestamp",
    "checkedInById" = src."checkedInById"
FROM (
  SELECT DISTINCT ON (pci."bookingId", x)
         pci."bookingId", x AS "assetId",
         pci."checkinTimestamp", pci."checkedInById"
  FROM "PartialBookingCheckin" pci, unnest(pci."assetIds") AS x
  ORDER BY pci."bookingId", x, pci."checkinTimestamp" ASC
) src
WHERE ba."bookingId" = src."bookingId"
  AND ba."assetId"   = src."assetId";

-- Backfill 4 — finished bookings with no check-in sessions: everything that
-- went out came back when the booking was completed.
UPDATE "BookingAsset" ba
SET "checkedInAt" = b."updatedAt"
FROM "Booking" b
WHERE ba."bookingId" = b.id
  AND ba."checkedInAt" IS NULL
  AND ba."checkedOutAt" IS NOT NULL
  AND b.status IN ('COMPLETE', 'ARCHIVED')
  AND NOT EXISTS (
    SELECT 1 FROM "PartialBookingCheckin" p WHERE p."bookingId" = b.id
  );

-- Partial index: the check-in guard reads one booking's outstanding slices, and
-- the WHERE clause keeps the index to those rows rather than every slice ever
-- booked.
--
-- Built in-transaction with the statements above, deliberately. The four
-- backfill UPDATEs already take row locks across this table for the length of
-- the migration, so a CONCURRENTLY build in a separate file would not shorten
-- the write-blocking window — it would only add a second migration that can
-- fail independently and leave an INVALID index behind. If this deploy window
-- ever needs shrinking, the backfills are what to attack, not the index.
CREATE INDEX IF NOT EXISTS "BookingAsset_bookingId_checkedOutAt_idx"
  ON "BookingAsset" ("bookingId")
  WHERE "checkedOutAt" IS NOT NULL AND "checkedInAt" IS NULL;
