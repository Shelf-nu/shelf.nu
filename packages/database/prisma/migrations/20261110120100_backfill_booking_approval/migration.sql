-- Stamps every existing reservation approved, so none reads as pending once
-- approval is on: nobody held them back. Only RESERVED rows are read as
-- pending, and `reserveBooking` writes the stamp itself (now, or NULL for a
-- request) whenever a booking becomes RESERVED, so other statuses are left
-- alone.
--
-- Its own migration, so this UPDATE does not run while the previous one
-- still holds its lock on "BookingSettings". Re-run once right after the
-- deploy, bounded by the time the previous app version stopped serving, for
-- reservations it made in between (see the PR's deploy steps).
UPDATE "Booking"
SET "approvedAt" = COALESCE("updatedAt", "createdAt", NOW())
WHERE "approvedAt" IS NULL
  AND "status" = 'RESERVED';
