-- Update tier_2 max organizations to tier_2
UPDATE "TierLimit"
SET "maxOrganizations" = 2
WHERE id = 'tier_2';