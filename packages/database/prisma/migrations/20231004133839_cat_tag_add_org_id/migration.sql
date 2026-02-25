/*
  Warnings:

  - Added the required column `organizationId` to the `Category` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `Tag` table without a default value. This is not possible if the table is not empty.

*/

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "organizationId" TEXT;
ALTER TABLE "Tag" ADD COLUMN     "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- add organizationId to tags and cats
UPDATE public."Category" AS c
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = c."userId" AND o.type = 'PERSONAL'
);

UPDATE public."Tag" AS t
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = t."userId" AND o.type = 'PERSONAL'
);

-- make orgId required
-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_organizationId_fkey";
ALTER TABLE "Category" DROP CONSTRAINT "Category_organizationId_fkey";

-- AlterTable
ALTER TABLE "Tag" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Category" ALTER COLUMN "organizationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
