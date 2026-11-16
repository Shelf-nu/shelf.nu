-- Booking approval, per requesting role. Both switches are off by default:
-- the feature is opt-in per workspace, so nothing changes for anyone until an
-- owner or administrator turns one on. A workspace that had the single switch
-- on keeps approval for Self service.
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForBase" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForSelfService" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BookingSettings"
SET "requireApprovalForSelfService" = "requireBookingApproval";

ALTER TABLE "BookingSettings" DROP COLUMN "requireBookingApproval";

-- Records the approval of a booking reservation request in the activity
-- log. The booking stays RESERVED when approved, so without this event the
-- decision would only live in a free-text note. Nothing in this migration
-- uses the new value.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_APPROVED';
