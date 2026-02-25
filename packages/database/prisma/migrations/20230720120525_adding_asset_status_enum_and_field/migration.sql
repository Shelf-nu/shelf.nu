-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'IN_CUSTODY');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE';
