-- Migration: Add Postgres functions for Supabase RPC calls
-- These replace inline $queryRaw/$executeRaw in the TypeScript codebase

-- =============================================================================
-- Sequential ID Functions (additional helpers)
-- =============================================================================

-- Get current sequence value without incrementing (for estimates/previews)
CREATE OR REPLACE FUNCTION get_current_sequence_value(org_id TEXT)
RETURNS BIGINT AS $$
DECLARE
    sequence_name TEXT;
    cur_val BIGINT;
BEGIN
    sequence_name := 'org_' || org_id || '_asset_sequence';

    -- Check if sequence exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_sequences
        WHERE schemaname = 'public'
        AND sequencename = sequence_name
    ) THEN
        RETURN NULL;
    END IF;

    -- Try to get current value (fails if nextval hasn't been called yet)
    BEGIN
        EXECUTE format('SELECT currval(%L)', sequence_name) INTO cur_val;
        RETURN cur_val;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
END;
$$ LANGUAGE plpgsql;

-- Get the highest sequential ID number for an organization
CREATE OR REPLACE FUNCTION get_max_sequential_id_number(
    org_id TEXT,
    prefix TEXT DEFAULT 'SAM'
)
RETURNS INTEGER AS $$
DECLARE
    max_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(
        CASE
            WHEN "sequentialId" ~ ('^' || prefix || '-[0-9]+$')
            THEN CAST(SUBSTRING("sequentialId" FROM (prefix || '-([0-9]+)')) AS INTEGER)
            ELSE 0
        END
    ), 0) INTO max_num
    FROM "Asset"
    WHERE "organizationId" = org_id
    AND "sequentialId" IS NOT NULL;

    RETURN max_num;
END;
$$ LANGUAGE plpgsql;

-- Get asset IDs that need sequential IDs (ordered for consistent assignment)
CREATE OR REPLACE FUNCTION get_assets_without_sequential_id(org_id TEXT)
RETURNS TABLE(id TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT a.id::TEXT
    FROM "Asset" a
    WHERE a."organizationId" = org_id
    AND a."sequentialId" IS NULL
    ORDER BY a.id ASC;
END;
$$ LANGUAGE plpgsql;

-- Batch update sequential IDs for assets
-- Takes parallel arrays of asset IDs and their new sequential IDs
CREATE OR REPLACE FUNCTION batch_update_sequential_ids(
    asset_ids TEXT[],
    sequential_ids TEXT[]
)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE "Asset"
    SET "sequentialId" = batch_data.sequential_id
    FROM (
        SELECT unnest(asset_ids) as asset_id,
               unnest(sequential_ids) as sequential_id
    ) as batch_data
    WHERE "Asset".id::TEXT = batch_data.asset_id
    AND "Asset"."sequentialId" IS NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Set a sequence to a specific value
CREATE OR REPLACE FUNCTION set_asset_sequence_value(
    org_id TEXT,
    new_value BIGINT
)
RETURNS VOID AS $$
DECLARE
    sequence_name TEXT;
BEGIN
    sequence_name := 'org_' || org_id || '_asset_sequence';

    -- Ensure sequence exists
    PERFORM create_asset_sequence_for_org(org_id);

    EXECUTE format(
        'SELECT setval(%L, GREATEST(%s, 1))',
        sequence_name,
        new_value
    );
END;
$$ LANGUAGE plpgsql;

-- Efficient bulk generation: assigns sequential IDs to all assets without one
-- Does everything in a single transaction in the database
CREATE OR REPLACE FUNCTION generate_bulk_sequential_ids(
    org_id TEXT,
    prefix TEXT DEFAULT 'SAM'
)
RETURNS INTEGER AS $$
DECLARE
    starting_number INTEGER;
    total_to_assign INTEGER;
    pad_width INTEGER;
    updated_count INTEGER;
BEGIN
    -- Ensure sequence exists
    PERFORM create_asset_sequence_for_org(org_id);

    -- Get the highest existing sequential ID number
    starting_number := get_max_sequential_id_number(org_id, prefix) + 1;

    -- Count assets that need IDs
    SELECT COUNT(*) INTO total_to_assign
    FROM "Asset"
    WHERE "organizationId" = org_id
    AND "sequentialId" IS NULL;

    IF total_to_assign = 0 THEN
        RETURN 0;
    END IF;

    -- Calculate padding width (at least 4, but grows for large numbers)
    pad_width := GREATEST(4, LENGTH((starting_number + total_to_assign)::TEXT));

    -- Assign sequential IDs using a window function for ordering
    WITH ranked_assets AS (
        SELECT a.id,
               ROW_NUMBER() OVER (ORDER BY a.id ASC) as row_num
        FROM "Asset" a
        WHERE a."organizationId" = org_id
        AND a."sequentialId" IS NULL
    )
    UPDATE "Asset"
    SET "sequentialId" = prefix || '-' || LPAD(
        (starting_number + ranked_assets.row_num - 1)::TEXT,
        pad_width,
        '0'
    )
    FROM ranked_assets
    WHERE "Asset".id = ranked_assets.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    -- Update the sequence to continue from the right place
    PERFORM set_asset_sequence_value(
        org_id,
        (SELECT COALESCE(COUNT(*), 0) FROM "Asset"
         WHERE "organizationId" = org_id AND "sequentialId" IS NOT NULL)
    );

    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Estimate the next sequential ID without consuming the sequence
CREATE OR REPLACE FUNCTION estimate_next_sequential_id(
    org_id TEXT,
    prefix TEXT DEFAULT 'SAM'
)
RETURNS TEXT AS $$
DECLARE
    cur_val BIGINT;
    max_num INTEGER;
    next_value INTEGER;
BEGIN
    -- Ensure sequence exists
    PERFORM create_asset_sequence_for_org(org_id);

    -- Try to get current sequence value
    cur_val := get_current_sequence_value(org_id);

    IF cur_val IS NOT NULL THEN
        next_value := cur_val + 1;
    ELSE
        -- Sequence hasn't been used yet, check existing IDs
        max_num := get_max_sequential_id_number(org_id, prefix);
        next_value := max_num + 1;
    END IF;

    RETURN prefix || '-' || LPAD(
        next_value::TEXT,
        GREATEST(4, LENGTH(next_value::TEXT)),
        '0'
    );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Location Hierarchy Functions (recursive CTEs)
-- =============================================================================

-- Get ancestor chain from a location up to the root, ordered root-first
CREATE OR REPLACE FUNCTION get_location_hierarchy(
    location_id TEXT,
    organization_id TEXT
)
RETURNS TABLE(id TEXT, name TEXT, "parentId" TEXT, depth INTEGER) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE location_hierarchy AS (
        SELECT
            l.id,
            l.name,
            l."parentId",
            l."organizationId",
            0 AS depth
        FROM "Location" l
        WHERE l.id = location_id AND l."organizationId" = organization_id
        UNION ALL
        SELECT
            p.id,
            p.name,
            p."parentId",
            p."organizationId",
            lh.depth + 1 AS depth
        FROM "Location" p
        INNER JOIN location_hierarchy lh ON lh."parentId" = p.id
        WHERE p."organizationId" = organization_id
    )
    SELECT lh2.id::TEXT, lh2.name::TEXT, lh2."parentId"::TEXT, lh2.depth::INTEGER
    FROM location_hierarchy lh2
    ORDER BY lh2.depth DESC;
END;
$$ LANGUAGE plpgsql;

-- Get all descendants of a location (flat list with parentId)
CREATE OR REPLACE FUNCTION get_location_descendants(
    location_id TEXT,
    organization_id TEXT
)
RETURNS TABLE(id TEXT, name TEXT, "parentId" TEXT) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE location_descendants AS (
        SELECT
            l.id,
            l.name,
            l."parentId",
            l."organizationId"
        FROM "Location" l
        WHERE l."parentId" = location_id AND l."organizationId" = organization_id
        UNION ALL
        SELECT
            c.id,
            c.name,
            c."parentId",
            c."organizationId"
        FROM "Location" c
        INNER JOIN location_descendants ld ON ld.id = c."parentId"
        WHERE c."organizationId" = organization_id
    )
    SELECT ld2.id::TEXT, ld2.name::TEXT, ld2."parentId"::TEXT
    FROM location_descendants ld2;
END;
$$ LANGUAGE plpgsql;

-- Get all descendant IDs (including self) for a location
CREATE OR REPLACE FUNCTION get_location_descendant_ids(
    location_id TEXT,
    organization_id TEXT
)
RETURNS TABLE(id TEXT, "parentId" TEXT) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE location_descendants AS (
        SELECT
            l.id,
            l."parentId",
            l."organizationId"
        FROM "Location" l
        WHERE l.id = location_id AND l."organizationId" = organization_id
        UNION ALL
        SELECT
            c.id,
            c."parentId",
            c."organizationId"
        FROM "Location" c
        INNER JOIN location_descendants ld ON ld.id = c."parentId"
        WHERE c."organizationId" = organization_id
    )
    SELECT ld2.id::TEXT, ld2."parentId"::TEXT
    FROM location_descendants ld2;
END;
$$ LANGUAGE plpgsql;

-- Get the maximum depth of a location's subtree
CREATE OR REPLACE FUNCTION get_location_subtree_depth(
    location_id TEXT,
    organization_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
    max_depth INTEGER;
BEGIN
    WITH RECURSIVE location_subtree AS (
        SELECT
            l.id,
            l."parentId",
            l."organizationId",
            0 AS depth
        FROM "Location" l
        WHERE l.id = location_id AND l."organizationId" = organization_id
        UNION ALL
        SELECT
            c.id,
            c."parentId",
            c."organizationId",
            ls.depth + 1 AS depth
        FROM "Location" c
        INNER JOIN location_subtree ls ON c."parentId" = ls.id
        WHERE c."organizationId" = organization_id
    )
    SELECT MAX(depth) INTO max_depth
    FROM location_subtree;

    RETURN COALESCE(max_depth, 0);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Auth Functions
-- =============================================================================

-- Look up auth user by email (queries auth schema)
CREATE OR REPLACE FUNCTION find_auth_user_by_email(user_email TEXT)
RETURNS TABLE(id TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT au.id::TEXT
    FROM auth.users au
    WHERE au.email = LOWER(user_email)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate a refresh token (queries auth schema)
CREATE OR REPLACE FUNCTION validate_refresh_token(refresh_token TEXT)
RETURNS TABLE(id TEXT, revoked BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.id::TEXT, rt.revoked
    FROM auth.refresh_tokens rt
    WHERE rt.token = refresh_token
    AND rt.revoked = false
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Custom Field Functions
-- =============================================================================

-- Get usage counts for custom fields in an organization
CREATE OR REPLACE FUNCTION get_custom_field_usage_counts(organization_id TEXT)
RETURNS TABLE("customFieldId" TEXT, count INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT
        acfv."customFieldId"::TEXT,
        COUNT(DISTINCT acfv."assetId")::INTEGER as count
    FROM "AssetCustomFieldValue" acfv
    INNER JOIN "CustomField" cf ON acfv."customFieldId" = cf.id
    WHERE cf."organizationId" = organization_id
      AND cf."deletedAt" IS NULL
    GROUP BY acfv."customFieldId";
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- User Functions
-- =============================================================================

-- Clear lastSelectedOrganizationId without bumping updatedAt
CREATE OR REPLACE FUNCTION clear_user_last_selected_org(
    user_id TEXT,
    organization_id TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE "User"
    SET "lastSelectedOrganizationId" = NULL
    WHERE "id" = user_id
      AND "lastSelectedOrganizationId" = organization_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Asset Index Settings Functions
-- =============================================================================

-- Remove a custom field column from all asset index settings in an org
CREATE OR REPLACE FUNCTION remove_custom_field_from_asset_index(
    column_name TEXT,
    organization_id TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE "AssetIndexSettings" AS ais
    SET "columns" = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(ais."columns") elem
        WHERE elem->>'name' <> column_name
    )
    WHERE ais."organizationId" = organization_id
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(ais."columns") elem
          WHERE elem->>'name' = column_name
      );
END;
$$ LANGUAGE plpgsql;
