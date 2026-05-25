-- Trigram (pg_trgm) GIN indexes for the columns the simple-mode asset search
-- bar runs ILIKE '%term%' against. Without these the planner falls back to
-- sequential scans because leading-wildcard LIKE cannot use B-tree indexes.
--
-- pg_trgm is already enabled by migration 20241218134155.
--
-- Locking: these are plain (non-CONCURRENT) CREATE INDEX statements, which
-- matches the existing convention in this repo (see migration
-- 20250114124237_add_reminder_indexes_for_optimization). Each statement
-- takes an ACCESS EXCLUSIVE lock on its table for the duration of the
-- index build. On the largest known tenant the affected tables are small
-- (~13k rows for Asset, Qr, Barcode; far fewer for Category, Location,
-- Tag), so the build completes in sub-second. If a much larger workspace
-- is onboarded later, run this migration during a low-traffic window or
-- split it across multiple CONCURRENTLY-built migrations.

-- Asset.sequentialId: hot path — customers type the numeric portion of their
-- SAM-IDs (e.g. "21035" to find "SAM-21035"). The existing
-- Asset_sequentialId_idx is plain B-tree and cannot serve %term%.
CREATE INDEX IF NOT EXISTS "Asset_sequentialId_trgm_idx"
  ON public."Asset" USING GIN ("sequentialId" gin_trgm_ops);

-- Category.name, Location.name, Tag.name: small tables but the OR-chain
-- joins them per searched term; without a trigram index every row of each
-- table is scanned.
CREATE INDEX IF NOT EXISTS "Category_name_trgm_idx"
  ON public."Category" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Location_name_trgm_idx"
  ON public."Location" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Tag_name_trgm_idx"
  ON public."Tag" USING GIN ("name" gin_trgm_ops);

-- Qr.id is the primary key (B-tree) but the search bar matches substrings
-- of QR ids ("...some-suffix..."), so we need a trigram index on the same
-- column. PK index covers exact lookups; this one covers fuzzy.
CREATE INDEX IF NOT EXISTS "Qr_id_trgm_idx"
  ON public."Qr" USING GIN (id gin_trgm_ops);

-- Barcode.value is searched the same way.
CREATE INDEX IF NOT EXISTS "Barcode_value_trgm_idx"
  ON public."Barcode" USING GIN (value gin_trgm_ops);
