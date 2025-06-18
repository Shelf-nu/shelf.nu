-- CreateEnum
CREATE TYPE "TagUseFor" AS ENUM ('ASSET', 'BOOKING');

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "useFor" "TagUseFor"[];
