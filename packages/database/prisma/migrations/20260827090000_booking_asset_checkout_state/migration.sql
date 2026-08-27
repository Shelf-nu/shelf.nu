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

-- Backfill 1 — progressive checkouts. Earliest session wins, matching
-- `getDetailedPartialCheckoutData`, which takes the first check-out per asset.
UPDATE "BookingAsset" ba
SET "checkedOutAt"   = src."checkoutTimestamp",
    "checkedOutById" = src."checkedOutById"
FROM (
  SELECT DISTINCT ON (pco."bookingId", x)
         pco."bookingId", x AS "assetId",
         pco."checkoutTimestamp", pco."checkedOutById"
  FROM "PartialBookingCheckout" pco, unnest(pco."assetIds") AS x
  ORDER BY pco."bookingId", x, pco."checkoutTimestamp" ASC
) src
WHERE ba."bookingId" = src."bookingId"
  AND ba."assetId"   = src."assetId";

-- Backfill 2 — all-at-once checkouts: bookings past RESERVED carrying NO
-- session rows at all. This is exactly the population the old
-- "no rows => everything is eligible" fallback covered, so it preserves current
-- behaviour rather than changing it. `Booking.updatedAt` is the closest
-- available stand-in for the checkout moment; the precise instant was never
-- recorded, which is the gap this column closes going forward.
UPDATE "BookingAsset" ba
SET "checkedOutAt" = b."updatedAt"
FROM "Booking" b
WHERE ba."bookingId" = b.id
  AND ba."checkedOutAt" IS NULL
  AND b.status IN ('ONGOING', 'OVERDUE', 'COMPLETE', 'ARCHIVED')
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

-- Partial index: the check-in guard reads the outstanding slices of one
-- booking, which is a small slice of a large table.
CREATE INDEX IF NOT EXISTS "BookingAsset_bookingId_checkedOutAt_idx"
  ON "BookingAsset" ("bookingId")
  WHERE "checkedOutAt" IS NOT NULL AND "checkedInAt" IS NULL;
