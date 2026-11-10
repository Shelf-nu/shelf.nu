-- Booking approval, per requesting role. Base is on by default (a Base
-- member never checks out themself, so the hand-over was always the
-- approval); Self service is off by default. A workspace that had the single
-- switch on keeps approval for Self service too.
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForBase" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForSelfService" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BookingSettings"
SET "requireApprovalForSelfService" = "requireBookingApproval";

ALTER TABLE "BookingSettings" DROP COLUMN "requireBookingApproval";

-- Records the approval of a booking reservation request in the activity
-- log. The booking stays RESERVED when approved, so without this event the
-- decision would only live in a free-text note. Nothing in this migration
-- uses the new value.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'BOOKING_APPROVED';
