-- A saved asset filter can be published to the whole workspace. The column is
-- additive with a default, so rows written by code that predates it stay
-- private, which is the behaviour every existing preset already had.
-- AlterTable
ALTER TABLE "public"."AssetFilterPreset" ADD COLUMN     "shared" BOOLEAN NOT NULL DEFAULT false;

-- The asset index reads every shared preset in the organization regardless of
-- owner, which the existing (organizationId, ownerId) index cannot answer.
-- CreateIndex
CREATE INDEX "asset_filter_presets_shared_lookup_idx" ON "public"."AssetFilterPreset"("organizationId", "shared");
