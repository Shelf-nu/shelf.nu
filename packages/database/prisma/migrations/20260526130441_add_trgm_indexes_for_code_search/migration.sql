-- Add GIN trigram indexes for the case-insensitive substring searches added
-- to the booking-add-assets modal and the audit asset picker on PR #2567.
-- Mirrors the pattern established by
-- `20241218134155_add_indexes_for_better_asset_search_performance` for
-- Asset.title + Asset.description and TeamMember.name.
--
-- These indexes back queries of the form:
--   WHERE EXISTS (SELECT 1 FROM "Barcode" WHERE "value" ILIKE '%x%' ...)
--   WHERE EXISTS (SELECT 1 FROM "Qr" WHERE "id" ILIKE '%x%' ...)
--
-- Without them, ILIKE %...% can't use a btree index and degrades to
-- full-table scans on the child tables — noticeable on orgs with many
-- barcodes per asset and / or many QR codes per asset.
--
-- pg_trgm extension is already enabled from the earlier migration; the
-- `CREATE EXTENSION IF NOT EXISTS` here is defensive (no-op on prod).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Barcode_value_trgm_idx"
  ON public."Barcode" USING gin (value gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Qr_id_trgm_idx"
  ON public."Qr" USING gin (id gin_trgm_ops);
