-- Trigram (pg_trgm) GIN index for the AssetModel.name column the asset search
-- bar runs ILIKE '%term%' against. Without it the planner falls back to a
-- sequential scan because leading-wildcard LIKE cannot use B-tree indexes, so
-- the existing AssetModel_organizationId_name_idx cannot serve the search.
--
-- pg_trgm is already enabled by migration 20241218134155.
--
-- Locking: a plain (non-CONCURRENT) CREATE INDEX, matching the convention of
-- migration 20260525110348_add_trigram_indexes_for_simple_search. It takes an
-- ACCESS EXCLUSIVE lock on AssetModel for the duration of the build. AssetModel
-- holds a handful of rows per workspace (one per model an operator has defined),
-- so the build completes in sub-second.

-- AssetModel.name: searching the model an asset belongs to ("Dell Latitude")
-- is how operators find every unit of one product, on the assets index and in
-- the model view's per-model counts.
CREATE INDEX IF NOT EXISTS "AssetModel_name_trgm_idx"
  ON public."AssetModel" USING GIN ("name" gin_trgm_ops);
