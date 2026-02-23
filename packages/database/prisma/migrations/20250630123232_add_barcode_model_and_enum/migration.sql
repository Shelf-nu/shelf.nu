-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('Code128', 'DataMatrix', 'Code39');

-- CreateTable
CREATE TABLE "Barcode" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "BarcodeType" NOT NULL DEFAULT 'Code128',
    "assetId" TEXT,
    "kitId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Barcode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Barcode_organizationId_value_idx" ON "Barcode"("organizationId", "value");

-- CreateIndex
CREATE INDEX "Barcode_assetId_idx" ON "Barcode"("assetId");

-- CreateIndex
CREATE INDEX "Barcode_kitId_idx" ON "Barcode"("kitId");

-- CreateIndex
CREATE INDEX "Barcode_organizationId_idx" ON "Barcode"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Barcode_organizationId_value_key" ON "Barcode"("organizationId", "value");

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "Kit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "Barcode" ENABLE row level security;
