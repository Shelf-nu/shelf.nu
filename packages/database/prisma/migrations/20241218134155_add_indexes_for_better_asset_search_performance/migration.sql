-- Migration: add_asset_search_indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add compound index for title and description using gin_trgm_ops
CREATE INDEX "Asset_title_description_idx" ON public."Asset" USING gin (title gin_trgm_ops, description gin_trgm_ops);

-- Add index for team member name search
CREATE INDEX "TeamMember_name_idx" ON public."TeamMember" USING gin (name gin_trgm_ops);