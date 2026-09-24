-- Add a GIN trigram index backing case-insensitive substring search over the
-- custom-field values in the assets index UNION (buildAssetSearchUnion).
--
-- The custom-field branch searches six JSON paths inside
-- AssetCustomFieldValue.value with leading-wildcard ILIKE. With no supporting
-- index the branch walked every org asset (measured ~2.3s on a 14k-asset org).
-- This functional GIN trigram index over the concatenated searchable paths
-- turns that into a Bitmap Index Scan (measured 2.3s -> ~15ms warm on that org;
-- full searched COUNT 2.6s -> ~0.3s).
--
-- The branch queries the SAME expression as an indexable prefilter and keeps
-- the exact per-path OR as a correctness filter (the concat is a strict
-- superset of the OR, so this stays exact-parity while gaining the index).
--
-- concat_ws is STABLE (not IMMUTABLE) so Postgres rejects it in an index
-- expression; COALESCE + || are IMMUTABLE, hence this form. Both the index and
-- the query must use this identical expression for the planner to match it.
--
-- Not CONCURRENTLY: Prisma runs each migration in a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside one. AssetCustomFieldValue is
-- small (tens of thousands of rows), so a plain build's brief write lock is
-- acceptable (see .claude rules on right-sizing migration lock impact). On prod
-- the index was already created manually (CONCURRENTLY) during validation, so
-- IF NOT EXISTS makes this a no-op there — no lock. pg_trgm is enabled by
-- earlier migrations; the CREATE EXTENSION is defensive (no-op on prod).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "AssetCustomFieldValue_searchable_trgm_idx"
  ON public."AssetCustomFieldValue"
  USING gin ((
    COALESCE(value #>> '{valueText}', '')          || ' ' ||
    COALESCE(value #>> '{valueMultiLineText}', '') || ' ' ||
    COALESCE(value #>> '{valueOption}', '')        || ' ' ||
    COALESCE(value #>> '{valueDate}', '')          || ' ' ||
    COALESCE(value #>> '{valueBoolean}', '')       || ' ' ||
    COALESCE(value #>> '{raw}', '')
  ) gin_trgm_ops);
