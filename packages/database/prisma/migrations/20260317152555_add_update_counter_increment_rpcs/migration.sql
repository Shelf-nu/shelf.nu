-- Migration: Add RPC functions for atomically incrementing Update counters
-- Used by the update service after migrating from Prisma to Supabase client

-- Increment viewCount for a single update
CREATE OR REPLACE FUNCTION increment_update_view_count(update_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE "Update"
    SET "viewCount" = "viewCount" + 1,
        "updatedAt" = NOW()
    WHERE "id" = update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment clickCount for a single update
CREATE OR REPLACE FUNCTION increment_update_click_count(update_id TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE "Update"
    SET "clickCount" = "clickCount" + 1,
        "updatedAt" = NOW()
    WHERE "id" = update_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment viewCount for multiple updates at once
CREATE OR REPLACE FUNCTION increment_update_view_count_bulk(update_ids TEXT[])
RETURNS VOID AS $$
BEGIN
    UPDATE "Update"
    SET "viewCount" = "viewCount" + 1,
        "updatedAt" = NOW()
    WHERE "id" = ANY(update_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
