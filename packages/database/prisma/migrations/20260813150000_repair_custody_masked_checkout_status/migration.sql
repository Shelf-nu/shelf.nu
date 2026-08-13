-- Repair: assets whose checked-out status was overwritten by a custody write.
--
-- Until #2830, custody flows set `Asset.status` unconditionally. Taking custody
-- of an asset already out on a booking overwrote CHECKED_OUT with IN_CUSTODY;
-- releasing the last custody row overwrote it with AVAILABLE.
--
-- That single column is what the availability maths asks "are you checked
-- out?". With the answer wrong, `computeCheckedOutBreakdownBatch` never takes
-- its legacy all-at-once branch, counts ZERO units as out, and free stock
-- overstates by exactly the booked quantity. A quantity-tracked asset with 29
-- total, 20 in custody and 5 out on an active booking advertised 9 free when
-- only 4 were.
--
-- #2830 guards every custody-driven write, so no NEW asset can reach this
-- state. It shipped no repair, and these rows do not self-heal.
--
-- ---------------------------------------------------------------------------
-- PROVING AN ASSET ACTUALLY WENT OUT
-- ---------------------------------------------------------------------------
-- "On a booking that is ONGOING" is NOT sufficient evidence, and treating it as
-- such would corrupt data rather than repair it. `partialCheckoutBooking` moves
-- a booking to ONGOING once the first asset is scanned, leaving the unscanned
-- ones untouched. An unscanned asset that is legitimately in someone's custody
-- would satisfy a naive EXISTS, be flipped to CHECKED_OUT, and — having no
-- checkout claim of its own — be read by `computeCheckedOutBreakdownBatch` as a
-- legacy all-at-once checkout, so its ENTIRE booked quantity would count as
-- out. That is the same bug this migration exists to fix, inverted.
--
-- `PartialBookingCheckout` rows are written by `partialCheckoutBooking` and by
-- nothing else, so their presence is a reliable discriminator:
--
--   * booking has NO PartialBookingCheckout rows  -> all-at-once checkout;
--     everything on the booking went out together, so membership is proof.
--   * booking HAS PartialBookingCheckout rows     -> progressive checkout;
--     ONLY assets named in those rows went out. Membership proves nothing.
--
-- This mirrors the discriminator the application itself uses (see the
-- "legacy all-at-once" branch in `computeCheckedOutBreakdownBatch`).
--
-- Not-yet-returned reuses the app's own definition too: per
-- `isAssetPartiallyCheckedIn` and the booking CSV export in
-- `app/utils/booking-assets.ts`, an asset is back once it appears in the
-- booking's partial check-ins.
--
-- Safe to re-run: both predicates stop matching once a row is repaired.

-- 1. Custody overwrote CHECKED_OUT with IN_CUSTODY.
UPDATE "Asset" a
SET status = 'CHECKED_OUT'
WHERE a.status = 'IN_CUSTODY'
  AND EXISTS (
    SELECT 1
    FROM "BookingAsset" ba
    JOIN "Booking" b ON b.id = ba."bookingId"
    WHERE ba."assetId" = a.id
      AND b.status IN ('ONGOING', 'OVERDUE')
      AND b."organizationId" = a."organizationId"
      AND (
        EXISTS (
          SELECT 1 FROM "PartialBookingCheckout" pco
          WHERE pco."bookingId" = b.id AND a.id = ANY (pco."assetIds")
        )
        OR NOT EXISTS (
          SELECT 1 FROM "PartialBookingCheckout" pco2
          WHERE pco2."bookingId" = b.id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "PartialBookingCheckin" pc
        WHERE pc."bookingId" = b.id AND a.id = ANY (pc."assetIds")
      )
  );

-- 2. A custody RELEASE overwrote CHECKED_OUT with AVAILABLE.
--
-- Deliberately stricter than statement 1: positive per-asset checkout evidence
-- only, never the all-at-once inference. `updateBookingAssets` leaves an asset
-- AVAILABLE on purpose when it is added to a booking AFTER checkout (#2815),
-- and on an all-at-once booking there is no per-asset record to tell that
-- apart from a wrongly-reset row. Assets in that ambiguous set are left alone;
-- over-reporting stock is bad, but claiming an on-shelf asset is out is worse.
UPDATE "Asset" a
SET status = 'CHECKED_OUT'
WHERE a.status = 'AVAILABLE'
  AND EXISTS (
    SELECT 1
    FROM "BookingAsset" ba
    JOIN "Booking" b ON b.id = ba."bookingId"
    WHERE ba."assetId" = a.id
      AND b.status IN ('ONGOING', 'OVERDUE')
      AND b."organizationId" = a."organizationId"
      AND EXISTS (
        SELECT 1 FROM "PartialBookingCheckout" pco
        WHERE pco."bookingId" = b.id AND a.id = ANY (pco."assetIds")
      )
      AND NOT EXISTS (
        SELECT 1 FROM "PartialBookingCheckin" pc
        WHERE pc."bookingId" = b.id AND a.id = ANY (pc."assetIds")
      )
  );
