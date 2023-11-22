WITH Duplicates AS (
  SELECT "id", "name", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("name"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "Category"
  WHERE "name" IS NOT NULL
)

UPDATE "Category" c1
SET "name" = c1."name" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE c1."id" = subquery."id" AND subquery."duplicate_count" > 1;

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_organizationId_key"
ON "Category" (LOWER("name"), "organizationId");
