-- This migration creates PostgreSQL sequences for sequential asset IDs
-- Each organization gets its own sequence to ensure independent numbering

-- Function to create sequence for an organization if it doesn't exist
CREATE OR REPLACE FUNCTION create_asset_sequence_for_org(org_id TEXT)
RETURNS VOID AS $$
DECLARE
    sequence_name TEXT;
BEGIN
    sequence_name := 'org_' || org_id || '_asset_sequence';
    
    -- Check if sequence already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_sequences 
        WHERE schemaname = 'public' 
        AND sequencename = sequence_name
    ) THEN
        -- Create the sequence starting at 1
        EXECUTE format('CREATE SEQUENCE %I START 1', sequence_name);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get next sequential ID for an organization
CREATE OR REPLACE FUNCTION get_next_sequential_id(org_id TEXT, prefix TEXT DEFAULT 'SAM')
RETURNS TEXT AS $$
DECLARE
    sequence_name TEXT;
    next_val BIGINT;
BEGIN
    sequence_name := 'org_' || org_id || '_asset_sequence';
    
    -- Ensure sequence exists
    PERFORM create_asset_sequence_for_org(org_id);
    
    -- Get next value
    EXECUTE format('SELECT nextval(%L)', sequence_name) INTO next_val;
    
    -- Return formatted sequential ID
    RETURN prefix || '-' || LPAD(next_val::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to reset sequence to current max + 1 for an organization
-- This will be used when bulk generating IDs for existing assets
CREATE OR REPLACE FUNCTION reset_asset_sequence_for_org(org_id TEXT)
RETURNS VOID AS $$
DECLARE
    sequence_name TEXT;
    max_seq_num BIGINT;
BEGIN
    sequence_name := 'org_' || org_id || '_asset_sequence';
    
    -- Ensure sequence exists
    PERFORM create_asset_sequence_for_org(org_id);
    
    -- Find the highest sequence number for this organization
    SELECT COALESCE(
        MAX(
            CASE 
                WHEN "sequentialId" ~ '^[A-Z]+-\d+$' 
                THEN CAST(SPLIT_PART("sequentialId", '-', 2) AS BIGINT)
                ELSE 0
            END
        ), 0
    ) INTO max_seq_num
    FROM "Asset" 
    WHERE "organizationId" = org_id 
    AND "sequentialId" IS NOT NULL;
    
    -- Reset sequence to max + 1
    EXECUTE format('SELECT setval(%L, %s)', sequence_name, max_seq_num + 1);
END;
$$ LANGUAGE plpgsql;