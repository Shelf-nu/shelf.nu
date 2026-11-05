-- Records the approval of a booking reservation request in the activity
-- log. The booking stays RESERVED when approved, so without this event the
-- decision would only live in a free-text note.
--
-- Additive: a new enum value only. Existing rows are untouched, and nothing
-- reads the value until the writer starts emitting it.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_APPROVED';
