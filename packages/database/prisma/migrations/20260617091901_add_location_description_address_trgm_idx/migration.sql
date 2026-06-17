-- Trigram (pg_trgm) GIN indexes for the Location.description and Location.address
-- columns, which the locations index search bar now matches with
-- ILIKE '%term%' alongside Location.name. Without these the OR predicate can't
-- use the existing Location_name_trgm_idx and degrades to a sequential scan.
--
-- Mirrors the pattern established for Location.name in migration
-- 20260525110348_add_trigram_indexes_for_simple_search. pg_trgm is already
-- enabled (migration 20241218134155); the CREATE EXTENSION here is a defensive
-- no-op on prod.
--
-- Locking: plain (non-CONCURRENT) CREATE INDEX, matching repo convention. The
-- Location table is small even on the largest known tenant (far fewer than the
-- ~13k-row Asset table), so each build completes in sub-second under its brief
-- ACCESS EXCLUSIVE lock.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Location_description_trgm_idx"
  ON public."Location" USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Location_address_trgm_idx"
  ON public."Location" USING gin (address gin_trgm_ops);
