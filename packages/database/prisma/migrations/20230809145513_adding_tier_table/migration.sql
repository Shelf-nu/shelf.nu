-- CreateEnum
CREATE TYPE "TierId" AS ENUM ('free', 'tier_1', 'tier_2');

-- CreateTable
CREATE TABLE "Tier" (
    "id" "TierId" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- Seed with some basic tiers. This is based on current setup we have on stripe
INSERT INTO "Tier" ("id", "name", "updatedAt")
VALUES
    ('free', 'Free', CURRENT_TIMESTAMP),
    ('tier_1', 'Plus', CURRENT_TIMESTAMP),
    ('tier_2', 'Team', CURRENT_TIMESTAMP);

-- Enable RLS
ALTER TABLE "Tier" ENABLE row level security;