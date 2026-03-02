-- Fix sequential ID padding for numbers beyond 9999
-- The original function used fixed 4-digit padding which caused issues when IDs exceeded 9999

-- Update the get_next_sequential_id function to handle padding correctly
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
    
    -- Return formatted sequential ID with proper padding
    -- Use GREATEST to ensure at least 4 digits but allow growth beyond 9999
    RETURN prefix || '-' || LPAD(next_val::text, GREATEST(4, LENGTH(next_val::text)), '0');
END;
$$ LANGUAGE plpgsql;