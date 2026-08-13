-- Repair: assets whose CHECKED_OUT status was overwritten by a custody write.
--
-- Until #2830 landed, custody flows set `Asset.status` unconditionally. Taking
-- custody of an asset that was already out on a booking overwrote CHECKED_OUT
-- with IN_CUSTODY. Releasing the last custody row overwrote it with AVAILABLE.
--
-- That single column is what the availability maths asks "are you checked
-- out?". With the answer wrong, `computeCheckedOutBreakdownBatch` never takes
-- its legacy all-at-once branch, counts ZERO units as out, and the free-stock
-- figure overstates by exactly the booked quantity. A quantity-tracked asset
-- with 29 total, 20 in custody and 5 out on an active booking advertised 9
-- free when only 4 were.
--
-- #2830 guards every custody-driven write, so no NEW asset can enter this
-- state. It shipped no repair, so rows that broke BEFORE it deployed stay
-- broken and do not self-heal: the status reads IN_CUSTODY, so the new
-- `not: CHECKED_OUT` guard does not match and a later release still walks it
-- to AVAILABLE.
--
-- WHAT COUNTS AS "STILL OUT" — deliberately mirrors the application's own
-- definition rather than inventing one. Per `isAssetPartiallyCheckedIn` and the
-- booking CSV export in `app/utils/booking-assets.ts`, an asset is checked out
-- when its booking is ONGOING/OVERDUE *and* it does not appear in that
-- booking's partial check-ins. Assets that were returned via a partial check-in
-- are excluded, so a returned asset is never re-flagged as out.
--
-- Safe to re-run: the WHERE clause stops matching once a row is repaired.
UPDATE "Asset" a
SET status = 'CHECKED_OUT'
WHERE a.status = 'IN_CUSTODY'
  AND EXISTS (
    SELECT 1
    FROM "BookingAsset" ba
    JOIN "Booking" b ON b.id = ba."bookingId"
    WHERE ba."assetId" = a.id
      AND b.status IN ('ONGOING', 'OVERDUE')
      -- Belt and braces: never let a cross-org row drive the decision.
      AND b."organizationId" = a."organizationId"
      AND NOT EXISTS (
        SELECT 1
        FROM "PartialBookingCheckin" pc
        WHERE pc."bookingId" = b.id
          AND a.id = ANY (pc."assetIds")
      )
  );
