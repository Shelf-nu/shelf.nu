-- Step 1: Retrieve all active CustomField records for each organization and calculate row numbers
WITH active_custom_fields AS (
    SELECT
        cf.id,
        cf.name,
        cf."organizationId",
        ROW_NUMBER() OVER (PARTITION BY cf."organizationId" ORDER BY cf.id) AS position
    FROM
        "CustomField" cf
    WHERE
        cf.active = true
)

-- Step 2: Construct the JSON object to be appended
, custom_field_json AS (
    SELECT
        cf."organizationId",
        json_agg(
            json_build_object(
                'name', CONCAT('cf_', cf.name),
                'position', cf.position,
                'visible', true
            )
        ) AS custom_fields_data
    FROM
        active_custom_fields cf
    GROUP BY
        cf."organizationId"
)

-- Step 3: Calculate the maximum position in the existing columns JSON array
, max_position AS (
    SELECT
        ais.id,
        ais."organizationId",
        COALESCE(MAX((elem->>'position')::int), -1) AS max_pos
    FROM
        "AssetIndexSettings" ais,
        jsonb_array_elements(ais.columns) AS elem
    GROUP BY
        ais.id, ais."organizationId"
)

-- Step 4: Update the columns field in AssetIndexSettings and return the updated rows
, updated_columns AS (
    SELECT
        ais.id,
        ais.columns,
        jsonb_agg(
            jsonb_set(
                cf.custom_field_data::jsonb,
                '{position}',
                to_jsonb(cf.position + mp.max_pos + 1)::jsonb
            )
        ) AS new_columns
    FROM
        "AssetIndexSettings" ais
    JOIN max_position mp ON ais.id = mp.id
    JOIN (
        SELECT
            cf."organizationId",
            json_build_object(
                'name', CONCAT('cf_', cf.name),
                'position', cf.position,
                'visible', true
            ) AS custom_field_data,
            cf.position
        FROM
            active_custom_fields cf
    ) cf ON ais."organizationId" = cf."organizationId"
    GROUP BY
        ais.id, ais.columns, mp.max_pos
)

UPDATE
    "AssetIndexSettings" ais
SET
    columns = ais.columns || uc.new_columns
FROM
    updated_columns uc
WHERE
    ais.id = uc.id
RETURNING ais.id, ais.columns;
