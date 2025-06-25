-- CreateEnum
CREATE TYPE "TagUseFor" AS ENUM ('ASSET', 'BOOKING');

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "useFor" "TagUseFor"[];

-- AlterTable
ALTER TABLE "Tag" ALTER COLUMN "useFor" SET DEFAULT ARRAY['ASSET']::"TagUseFor"[];
