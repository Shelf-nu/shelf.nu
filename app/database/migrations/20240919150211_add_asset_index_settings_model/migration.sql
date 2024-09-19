-- CreateEnum
CREATE TYPE "AssetIndexMode" AS ENUM ('SIMPLE', 'ADVANCED');

-- CreateTable
CREATE TABLE "AssetIndexSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "AssetIndexMode" NOT NULL DEFAULT 'SIMPLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetIndexSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetIndexSettings_userId_organizationId_key" ON "AssetIndexSettings"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "AssetIndexSettings" ADD CONSTRAINT "AssetIndexSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "AssetIndexSettings" ENABLE row level security;
