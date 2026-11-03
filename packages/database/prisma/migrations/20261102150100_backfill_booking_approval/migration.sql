-- Every booking that exists before approval can be required has, by
-- definition, not been held back by anyone: stamp it approved so turning the
-- workspace switch on later never flags an old reservation as pending.
-- From here on `reserveBooking` writes the stamp itself (now, or NULL for a
-- request made while the switch is on), so no later sweep is needed.
--
-- Data only: touches rows with no stamp, sets nothing else.
UPDATE "Booking"
SET "approvedAt" = COALESCE("updatedAt", "createdAt", NOW())
WHERE "approvedAt" IS NULL;
