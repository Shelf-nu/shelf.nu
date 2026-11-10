-- Drops what PdfTemplate (20261103120000_add_pdf_templates) replaced: the
-- PdfDocument table and its enum, and the plan gate and seeding marker that
-- only the PdfDocument code read.
--
-- Run this AFTER the build without these fields is live everywhere. The build
-- before it selects every scalar of Organization and TierLimit, so dropping
-- the columns under it fails those reads.

-- DropTable (its indexes, foreign key and row level security go with it)
DROP TABLE "PdfDocument";

-- DropEnum
DROP TYPE "PdfDocumentKind";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "paidPdfDocumentsSeededAt";

-- AlterTable
ALTER TABLE "TierLimit" DROP COLUMN "canCustomizePdfDocuments";

-- AlterTable
ALTER TABLE "CustomTierLimit" DROP COLUMN "canCustomizePdfDocuments";
