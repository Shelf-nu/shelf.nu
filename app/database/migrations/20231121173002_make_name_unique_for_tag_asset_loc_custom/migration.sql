-- deduplicate asset title
WITH Duplicates AS (
  SELECT "id", "title", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("title"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "Asset"
  WHERE "title" IS NOT NULL
)

UPDATE "Asset" e
SET "title" = e."title" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE e."id" = subquery."id" AND subquery."duplicate_count" > 1;

-- deduplicate CustomField title
WITH Duplicates AS (
  SELECT "id", "name", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("name"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "CustomField"
  WHERE "name" IS NOT NULL
)

UPDATE "CustomField" e
SET "name" = e."name" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE e."id" = subquery."id" AND subquery."duplicate_count" > 1;

-- deduplicate Location title
WITH Duplicates AS (
  SELECT "id", "name", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("name"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "Location"
  WHERE "name" IS NOT NULL
)

UPDATE "Location" e
SET "name" = e."name" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE e."id" = subquery."id" AND subquery."duplicate_count" > 1;


-- deduplicate Tag title
WITH Duplicates AS (
  SELECT "id", "name", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("name"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "Tag"
  WHERE "name" IS NOT NULL
)

UPDATE "Tag" e
SET "name" = e."name" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE e."id" = subquery."id" AND subquery."duplicate_count" > 1;


-- CreateIndex
CREATE UNIQUE INDEX "Asset_title_organizationId_key" ON "Asset"(LOWER("title"), "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_name_organizationId_key" ON "CustomField"(LOWER("name"), "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_organizationId_key" ON "Location"(LOWER("name"), "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_organizationId_key" ON "Tag"(LOWER("name"), "organizationId");
