-- Composite index serving the advanced asset index's default view:
--   WHERE "organizationId" = ? ORDER BY "createdAt" DESC, "id" ASC LIMIT n
--
-- Column order matters: (organizationId, createdAt DESC, id) lets Postgres seek
-- the org and walk the index in the exact ORDER BY direction, returning the page
-- via early-termination instead of scanning + sorting the whole table. The
-- existing Asset_createdAt_organizationId_idx has the columns reversed
-- (createdAt first) and cannot serve this query efficiently.
--
-- Pairs with the paginate-first query rewrite (buildAdvancedAssetsQuery): the
-- rewrite makes the per-row projection O(pageSize); this index makes selecting
-- WHICH rows form the page early-terminating too.
--
-- Locking: plain (non-CONCURRENT) CREATE INDEX, matching repo convention. The
-- Asset table is ~13k rows even on the largest tenant, so the build completes in
-- sub-second under its brief lock.

CREATE INDEX IF NOT EXISTS "Asset_organizationId_createdAt_id_idx"
  ON public."Asset" ("organizationId", "createdAt" DESC, "id");
