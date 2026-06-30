-- Phase 4b-Polish-4: discriminate kit-driven AssetLocation rows from
-- manual placements, so adding an asset to a kit can place units at the
-- kit's location additively (without wiping the user's existing manual
-- placements) and so the UI can render a "via kit" badge on those rows.
--
-- Mirrors the Phase 2 `Custody.kitCustodyId` discriminator pattern.
-- Schema reasoning + cascade matrix in
--   apps/webapp/app/modules/kit/service.server.ts
-- and the Polish-4 subsection of CLAUDE-CONTEXT.md.

-- 1. Add the discriminator column. NULLable: existing rows stay
--    manual placements (assetKitId IS NULL). No backfill: the buggy
--    pre-Polish-4 cascade already left those rows in an inconsistent
--    state (full-pool qty at kit location, manual rows wiped), so an
--    auto-classification heuristic would mislabel more often than help.
--    Users clean them up via the new manage-placements dialog after
--    deploy.
ALTER TABLE "AssetLocation"
  ADD COLUMN "assetKitId" TEXT;

-- 2. FK to AssetKit with cascade delete — leaving the kit (AssetKit
--    row removed) auto-deletes the kit-driven AssetLocation row.
ALTER TABLE "AssetLocation"
  ADD CONSTRAINT "AssetLocation_assetKitId_fkey"
    FOREIGN KEY ("assetKitId") REFERENCES "AssetKit"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 3. Index for the FK lookup (cascade fast-path + cascade-rewrite
--    queries that read all kit-driven rows for an AssetKit).
CREATE INDEX "AssetLocation_assetKitId_idx"
  ON "AssetLocation"("assetKitId");

-- 4. Relax the (assetId, locationId) unique constraint to allow a
--    manual row and one (or more) kit-driven rows to coexist at the
--    same location. Two partial uniques replace it:
--
--    a) Manual placements: at most one row per (assetId, locationId)
--       WHERE assetKitId IS NULL — the existing user-facing invariant.
--    b) Kit-driven placements: at most one row per assetKitId — each
--       kit membership drives exactly one location row. AssetKit
--       itself is unique on (assetId, kitId), so this transitively
--       caps kit-driven rows at one per (asset, kit) pair.
--
--    Both indexes use `WHERE` clauses (partial unique indexes,
--    supported by Postgres since 9.0). Prisma can't express partial
--    uniques in `schema.prisma`, so they live here and the model has
--    a comment pointing at them.
DROP INDEX "AssetLocation_assetId_locationId_key";

CREATE UNIQUE INDEX "AssetLocation_manual_unique"
  ON "AssetLocation"("assetId", "locationId")
  WHERE "assetKitId" IS NULL;

CREATE UNIQUE INDEX "AssetLocation_kit_unique"
  ON "AssetLocation"("assetKitId")
  WHERE "assetKitId" IS NOT NULL;
