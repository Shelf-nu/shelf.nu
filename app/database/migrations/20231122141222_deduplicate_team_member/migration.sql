
ALTER TABLE "TeamMember" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- migrate relationship
UPDATE "TeamMember"
SET "organizationId" = (
    SELECT "A" FROM "_OrganizationToTeamMember" WHERE "B" = "TeamMember".id
);

ALTER TABLE "TeamMember" ALTER COLUMN "organizationId" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "_OrganizationToTeamMember" DROP CONSTRAINT "_OrganizationToTeamMember_A_fkey";

-- DropForeignKey
ALTER TABLE "_OrganizationToTeamMember" DROP CONSTRAINT "_OrganizationToTeamMember_B_fkey";

-- DropTable
DROP TABLE "_OrganizationToTeamMember";

-- deduplicate names title
WITH Duplicates AS (
  SELECT "id", "name", "organizationId", 
         ROW_NUMBER() OVER (PARTITION BY LOWER("name"), "organizationId" ORDER BY "createdAt") AS duplicate_count
  FROM "TeamMember"
  WHERE "name" IS NOT NULL
)

UPDATE "TeamMember" e
SET "name" = e."name" || '-' || subquery."duplicate_count"
FROM Duplicates subquery
WHERE e."id" = subquery."id" AND subquery."duplicate_count" > 1;
