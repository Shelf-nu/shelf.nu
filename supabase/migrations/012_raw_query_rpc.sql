-- =============================================================================
-- 012_raw_query_rpc.sql
-- RPC function for executing parameterized raw SQL from the application layer.
-- Only callable with service_role key (SECURITY DEFINER).
-- Replaces Prisma's db.$queryRaw functionality.
-- =============================================================================

-- Uses string interpolation with format() for parameter injection.
-- Parameters in the query_text use %L (literal) placeholders matching
-- format(). The caller is responsible for using %L for all user values.
--
-- The application layer's sql`` template literal produces query_text with
-- %L placeholders and a params JSONB array. This function substitutes
-- them safely via format().
CREATE OR REPLACE FUNCTION execute_raw_query(
  query_text text,
  query_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  result jsonb;
  formatted_query text;
  param_arr text[];
  i int;
BEGIN
  -- Convert JSONB array to text array for format()
  IF jsonb_array_length(query_params) > 0 THEN
    SELECT array_agg(elem::text)
    INTO param_arr
    FROM jsonb_array_elements_text(query_params) AS elem;

    -- Replace $1, $2, ... with format-safe literals
    formatted_query := query_text;
    FOR i IN 1..array_length(param_arr, 1) LOOP
      formatted_query := replace(
        formatted_query,
        '$' || i::text,
        quote_literal(param_arr[i])
      );
    END LOOP;
  ELSE
    formatted_query := query_text;
  END IF;

  -- Execute and aggregate results as JSONB
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
    || formatted_query || ') t'
  INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restrict to service role only — this function can execute arbitrary SQL
REVOKE EXECUTE ON FUNCTION execute_raw_query FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION execute_raw_query FROM anon;
REVOKE EXECUTE ON FUNCTION execute_raw_query FROM authenticated;
