-- Records a change to an asset's "Available for bookings" switch
-- (`Asset.availableToBook`) in the activity log: the asset page toggle, the
-- bulk "Mark as available / unavailable" action and the CSV update import.
--
-- Additive: a new enum value only. Existing rows are untouched, and nothing
-- reads the value until the writers start emitting it.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ASSET_AVAILABLE_TO_BOOK_CHANGED';
