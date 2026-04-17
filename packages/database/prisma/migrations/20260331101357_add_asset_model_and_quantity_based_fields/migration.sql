-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('INDIVIDUAL', 'QUANTITY_TRACKED');

-- CreateEnum
CREATE TYPE "ConsumptionType" AS ENUM ('ONE_WAY', 'TWO_WAY');

-- CreateEnum
CREATE TYPE "ConsumptionCategory" AS ENUM ('CHECKOUT', 'RETURN', 'RESTOCK', 'ADJUSTMENT', 'LOSS');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "assetModelId" TEXT,
ADD COLUMN     "consumptionType" "ConsumptionType",
ADD COLUMN     "minQuantity" INTEGER,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "type" "AssetType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "unitOfMeasure" TEXT;

-- CreateTable
CREATE TABLE "AssetModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "imageExpiration" TIMESTAMP(3),
    "defaultCategoryId" TEXT,
    "defaultValuation" DOUBLE PRECISION,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionLog" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "category" "ConsumptionCategory" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT,
    "custodianId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAsset" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BookingAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetModel_organizationId_name_idx" ON "AssetModel"("organizationId", "name");

-- CreateIndex
CREATE INDEX "AssetModel_userId_idx" ON "AssetModel"("userId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_assetId_createdAt_idx" ON "ConsumptionLog"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsumptionLog_userId_idx" ON "ConsumptionLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAsset_bookingId_assetId_key" ON "BookingAsset"("bookingId", "assetId");

-- CreateIndex
CREATE INDEX "Asset_assetModelId_organizationId_idx" ON "Asset"("assetModelId", "organizationId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_assetModelId_fkey" FOREIGN KEY ("assetModelId") REFERENCES "AssetModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetModel" ADD CONSTRAINT "AssetModel_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetModel" ADD CONSTRAINT "AssetModel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetModel" ADD CONSTRAINT "AssetModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAsset" ADD CONSTRAINT "BookingAsset_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAsset" ADD CONSTRAINT "BookingAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Enable RLS
ALTER TABLE "AssetModel" ENABLE row level security;
ALTER TABLE "ConsumptionLog" ENABLE row level security;
ALTER TABLE "BookingAsset" ENABLE row level security;