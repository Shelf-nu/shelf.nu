-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_itemId_fkey";

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
