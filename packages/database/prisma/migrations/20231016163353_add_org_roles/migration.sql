/*
  Warnings:

  - Made the column `teamMemberId` on table `Invite` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "InviteStatuses" ADD VALUE 'INVALIDATED';

-- AlterEnum
ALTER TYPE "OrganizationRoles" ADD VALUE 'OWNER';

-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_teamMemberId_fkey";

-- AlterTable
ALTER TABLE "Invite" ALTER COLUMN "teamMemberId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE if NOT exists "UserOrganization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roles" "OrganizationRoles"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserOrganization_id_key" ON "UserOrganization"("id");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrganization_userId_organizationId_key" ON "UserOrganization"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;