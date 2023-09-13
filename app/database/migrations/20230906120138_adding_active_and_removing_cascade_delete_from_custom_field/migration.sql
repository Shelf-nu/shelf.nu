-- DropForeignKey
ALTER TABLE "AssetCustomFieldValue" DROP CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey";

-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "AssetCustomFieldValue" ADD CONSTRAINT "AssetCustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
