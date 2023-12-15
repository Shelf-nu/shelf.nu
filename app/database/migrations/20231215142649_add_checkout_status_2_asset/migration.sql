/*
  Warnings:

  - The values [BOOKED] on the enum `AssetStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AssetStatus_new" AS ENUM ('AVAILABLE', 'IN_CUSTODY', 'CHECKED_OUT');
ALTER TABLE "Asset" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Asset" ALTER COLUMN "status" TYPE "AssetStatus_new" USING ("status"::text::"AssetStatus_new");
ALTER TYPE "AssetStatus" RENAME TO "AssetStatus_old";
ALTER TYPE "AssetStatus_new" RENAME TO "AssetStatus";
DROP TYPE "AssetStatus_old";
ALTER TABLE "Asset" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
COMMIT;
