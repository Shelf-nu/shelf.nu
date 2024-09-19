-- Populate the table with entries for each user organization
INSERT INTO "AssetIndexSettings" ("id", "userId", "organizationId", "createdAt", "updatedAt")
SELECT uuid_generate_v4(), uo."userId", uo."organizationId", NOW(), NOW()
FROM "UserOrganization" uo
LEFT JOIN "AssetIndexSettings" ais
ON uo."userId" = ais."userId" AND uo."organizationId" = ais."organizationId"
WHERE ais."userId" IS NULL AND ais."organizationId" IS NULL;