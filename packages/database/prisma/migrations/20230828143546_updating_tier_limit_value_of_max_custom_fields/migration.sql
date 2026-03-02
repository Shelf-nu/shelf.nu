-- Setting the free to 3 and the tiers to 100
UPDATE "TierLimit" SET "maxCustomFields" = 3 WHERE "id" = 'free';
UPDATE "TierLimit" SET "maxCustomFields" = 100 WHERE "id" = 'tier_1';
UPDATE "TierLimit" SET "maxCustomFields" = 100 WHERE "id" = 'tier_2';