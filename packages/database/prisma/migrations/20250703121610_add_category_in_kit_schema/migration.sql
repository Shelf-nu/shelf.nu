-- AlterTable
ALTER TABLE "Kit" ADD COLUMN     "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "Kit" ADD CONSTRAINT "Kit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
