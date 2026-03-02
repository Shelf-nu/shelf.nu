-- Seed Tier table with custom tier
INSERT INTO "Tier" ("id", "name", "updatedAt")
VALUES
    ('custom', 'Custom', CURRENT_TIMESTAMP);


-- CreateTable
CREATE TABLE "CustomTierLimit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "canImportAssets" BOOLEAN NOT NULL DEFAULT true,
    "canExportAssets" BOOLEAN NOT NULL DEFAULT true,
    "maxCustomFields" INTEGER NOT NULL DEFAULT 1000,
    "maxOrganizations" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomTierLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomTierLimit_id_key" ON "CustomTierLimit"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomTierLimit_userId_key" ON "CustomTierLimit"("userId");

-- AddForeignKey
ALTER TABLE "CustomTierLimit" ADD CONSTRAINT "CustomTierLimit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add RLS
ALTER TABLE "CustomTierLimit" ENABLE row level security;
