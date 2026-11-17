-- When a workspace first turned a booking approval switch on. The settings
-- save that does so stamps the workspace's unapproved reservations approved,
-- so leftovers from before the feature (or from the deploy overlap) never read
-- as pending requests, with no manual step after the deploy. It replaces the
-- post-deploy re-run that 20261110120100_backfill_booking_approval mentions.
ALTER TABLE "BookingSettings" ADD COLUMN "approvalFirstEnabledAt" TIMESTAMPTZ(3);

-- A workspace that already has a switch on has had its first switch-on: its
-- unapproved reservations may be real requests, so it is never stamped.
UPDATE "BookingSettings"
SET "approvalFirstEnabledAt" = NOW()
WHERE "requireApprovalForBase" OR "requireApprovalForSelfService";
