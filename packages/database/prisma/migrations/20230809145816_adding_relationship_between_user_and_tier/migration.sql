-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tierId" "TierId" NOT NULL DEFAULT 'free';

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
