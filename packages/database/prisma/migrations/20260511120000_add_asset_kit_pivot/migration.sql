-- Phase 4a — Replace Asset.kitId 1:1 FK with AssetKit pivot table.
--
-- Structural-only change: every existing Asset.kitId becomes one
-- AssetKit row. A @@unique([assetId]) constraint preserves the
-- "at most one kit per asset" invariant. The pivot's `quantity`
-- defaults to 1 and stays at 1 in this phase; future work drops
-- the assetId unique constraint and introduces type-aware single-
-- row + sum-within-total triggers when multi-kit allocation lands.
--
-- Migration shape: introduce → backfill → drop, all in one
-- transaction-scoped migration so no half-pivoted state is
-- observable to app code.

-- 1. Create the AssetKit pivot table.
CREATE TABLE "AssetKit" (
  "id"             TEXT NOT NULL,
  "assetId"        TEXT NOT NULL,
  "kitId"          TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL DEFAULT 1,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetKit_pkey" PRIMARY KEY ("id")
);

-- 1:1 today; drop when multi-kit allocation lands.
CREATE UNIQUE INDEX "AssetKit_assetId_key"        ON "AssetKit"("assetId");
CREATE UNIQUE INDEX "AssetKit_assetId_kitId_key"  ON "AssetKit"("assetId", "kitId");
CREATE INDEX        "AssetKit_kitId_idx"          ON "AssetKit"("kitId");
CREATE INDEX        "AssetKit_organizationId_idx" ON "AssetKit"("organizationId");

ALTER TABLE "AssetKit"
  ADD CONSTRAINT "AssetKit_assetId_fkey"
    FOREIGN KEY ("assetId")        REFERENCES "Asset"("id")        ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetKit_kitId_fkey"
    FOREIGN KEY ("kitId")          REFERENCES "Kit"("id")          ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssetKit_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill — one row per asset currently in a kit. quantity = 1
--    is correct for every row in this phase: pre-pivot the schema
--    couldn't express multi-kit allocation, so each row simply
--    represents "this asset belongs to this kit." Quantity-aware
--    behaviour layers on top in a follow-up phase.
INSERT INTO "AssetKit" ("id", "assetId", "kitId", "organizationId", "quantity", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  a."id",
  a."kitId",
  a."organizationId",
  1,
  now(),
  now()
FROM "Asset" a
WHERE a."kitId" IS NOT NULL;

-- 3. Drop the legacy column + its index.
DROP INDEX IF EXISTS "Asset_kitId_organizationId_idx";
ALTER TABLE "Asset" DROP CONSTRAINT IF EXISTS "Asset_kitId_fkey";
ALTER TABLE "Asset" DROP COLUMN "kitId";

-- 4. Enable RLS to match the Kit / KitCustody / BookingModelRequest
--    pattern (Supabase default-deny; no explicit policy needed since
--    all access goes through the Prisma client which carries the
--    service-role JWT).
ALTER TABLE "AssetKit" ENABLE row level security;
