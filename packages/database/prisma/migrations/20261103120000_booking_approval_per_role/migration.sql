-- Booking approval becomes a per-role choice. Base is on by default (a Base
-- member never checks out themself, so the hand-over was always the
-- approval); Self service is off by default. A workspace that had the single
-- switch on keeps approval for Self service too.
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForBase" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BookingSettings" ADD COLUMN "requireApprovalForSelfService" BOOLEAN NOT NULL DEFAULT false;

UPDATE "BookingSettings"
SET "requireApprovalForSelfService" = "requireBookingApproval";

ALTER TABLE "BookingSettings" DROP COLUMN "requireBookingApproval";
