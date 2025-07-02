-- AlterEnum
ALTER TYPE "BarcodeType" ADD VALUE 'Code39';

-- Enable RLS
ALTER TABLE "Barcode" ENABLE row level security;
