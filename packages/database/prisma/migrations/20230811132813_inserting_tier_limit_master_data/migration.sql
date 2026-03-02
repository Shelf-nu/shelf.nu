-- Create default Tier limits
INSERT INTO "TierLimit" ("id", "canImportAssets", "canExportAssets", "updatedAt")
SELECT t.id,
       CASE
           WHEN t.id = 'free' THEN false
           ELSE true
       END AS "canImportAssets",
       CASE
           WHEN t.id = 'free' THEN false
           ELSE true
       END AS "canExportAssets",
       CURRENT_TIMESTAMP AS updatedAt
FROM "Tier" AS t;

-- Update relationships in Tier table
UPDATE "Tier"
SET "tierLimitId" = t.id
FROM "TierLimit" AS t
WHERE "Tier"."id" = t.id;