-- Records WHICH model reservation a booking-asset row discharged.
--
-- Before this, the link existed only in prose: `materializeModelRequestForAsset`
-- writes an activity note ("assigned X (Model A) — 2 × Model A remaining") and
-- the relationship is then unrecoverable. An assigned asset is indistinguishable
-- from one added by hand, so "which assets fulfilled the LED reservation?"
-- cannot be answered from data.
--
-- Additive and reversible: a nullable column plus an index and FK. Existing rows
-- get NULL, which is the correct value for every asset added directly.
--
-- ON DELETE SET NULL, not CASCADE: if a reservation row is ever removed, the
-- asset stays committed to the booking and only loses provenance. Deleting the
-- asset would silently strip real kit from a booking. In practice this rarely
-- fires — `removeBookingModelRequest` refuses when `fulfilledQuantity > 0` — so
-- the realistic path is the booking cascade, which removes both together.

ALTER TABLE "BookingAsset"
  ADD COLUMN IF NOT EXISTS "bookingModelRequestId" TEXT;

-- Partial index: only assigned rows carry a value, and they are the minority.
CREATE INDEX IF NOT EXISTS "BookingAsset_bookingModelRequestId_idx"
  ON "BookingAsset" ("bookingModelRequestId")
  WHERE "bookingModelRequestId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'BookingAsset_bookingModelRequestId_fkey'
  ) THEN
    ALTER TABLE "BookingAsset"
      ADD CONSTRAINT "BookingAsset_bookingModelRequestId_fkey"
      FOREIGN KEY ("bookingModelRequestId")
      REFERENCES "BookingModelRequest"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
