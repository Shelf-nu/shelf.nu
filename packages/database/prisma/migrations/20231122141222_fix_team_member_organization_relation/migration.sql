
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
