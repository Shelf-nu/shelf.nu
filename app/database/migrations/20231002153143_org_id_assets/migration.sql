
-- make sure all users have personal orgnanization, if not create 1 for them

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- for uuid_generate_v4() there is no cuid extention at the moment, still it should not be a problem as we treat ids as nothing more than unique strings and all users should have orgIds, this is just a backup logic

INSERT INTO public."Organization" (id, name, type, "userId", "updatedAt")
SELECT uuid_generate_v4(), 'Personal', 'PERSONAL', u.id, NOW()
FROM public."User" u
WHERE NOT EXISTS (
  SELECT 1
  FROM public."Organization" o
  WHERE o."userId" = u.id
);

-- add organizationId to assets
UPDATE public."Asset" AS a
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = a."userId" AND o.type = 'PERSONAL'
);
-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_organizationId_fkey";

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "organizationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
