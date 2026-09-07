-- Add Book-by-Model reservation actions to the ActivityAction enum.
--
-- `BookingModelRequest` mutations previously wrote a system BookingNote but no
-- ActivityEvent, so the reporting pipeline could not answer "who committed to N
-- units of this model, and when did that change?" — the note feed is prose, not
-- aggregatable. These four actions close that gap:
--
--   BOOKING_MODEL_REQUESTED         a reservation row was created
--   BOOKING_MODEL_REQUEST_CHANGED   one field changed (field/fromValue/toValue;
--                                   `quantity` and `fulfilledAt` get separate
--                                   events per the record-event-payload-shapes rule)
--   BOOKING_MODEL_REQUEST_REMOVED   the reservation was cancelled
--   BOOKING_MODEL_REQUEST_FULFILLED one unit was assigned by a scan (one event
--                                   per unit, carrying the concrete assetId)
--
-- Additive and idempotent (IF NOT EXISTS); no data backfill — historical
-- reservations predate the event stream and their BookingNotes remain the only
-- record. No lock concern at Shelf's table scale.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_MODEL_REQUESTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_MODEL_REQUEST_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_MODEL_REQUEST_REMOVED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_MODEL_REQUEST_FULFILLED';
