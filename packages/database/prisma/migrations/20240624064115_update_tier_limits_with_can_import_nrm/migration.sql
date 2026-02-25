-- Update the value of canImportNRM to true for the tiers with the ids 'tier_1' and 'tier_2'
UPDATE "TierLimit"
SET "canImportNRM" = true
WHERE id IN ('tier_1', 'tier_2');