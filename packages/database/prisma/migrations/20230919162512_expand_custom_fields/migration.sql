-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CustomFieldType" ADD VALUE 'OPTION';
ALTER TYPE "CustomFieldType" ADD VALUE 'BOOLEAN';
ALTER TYPE "CustomFieldType" ADD VALUE 'DATE';
ALTER TYPE "CustomFieldType" ADD VALUE 'MULTILINE_TEXT';

-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN     "options" TEXT[];

-- add jsonB as temp column
ALTER TABLE "AssetCustomFieldValue" ADD COLUMN  "valueJson" JSONB;

-- migrate the old data from value to valueJson
-- Update the "valueJsonb" column based on "CustomFieldType"
UPDATE "AssetCustomFieldValue"
SET "valueJson" =
  CASE
    WHEN "customFieldId" IS NOT NULL AND "value" IS NOT NULL THEN
      jsonb_build_object(
        'raw', "value"::TEXT,
        'valueText', "value"::TEXT
      )
    ELSE
      NULL
  END;

-- drop old value column
ALTER TABLE "AssetCustomFieldValue"
DROP COLUMN "value";

--- rename valueJson to value
ALTER TABLE "AssetCustomFieldValue"
RENAME COLUMN "valueJson" TO "value";

--make it nonNull
ALTER TABLE "AssetCustomFieldValue"
ALTER COLUMN "value" SET NOT NULL;

-- add constaint to json schema
ALTER TABLE "AssetCustomFieldValue"
ADD CONSTRAINT ensure_value_structure_and_types
CHECK (
    (
        -- Check if the JSONB data contains "raw" key and it's not null
        ("value" ->> 'raw' IS NOT NULL)
        AND
        (
            (
                "value" ->> 'valueText' IS NOT NULL
                AND jsonb_typeof("value" -> 'valueText') = 'string'
            )
            OR
            (
                "value" ->> 'valueMultiLineText' IS NOT NULL
                AND jsonb_typeof("value" -> 'valueMultiLineText') = 'string'
            )
            OR
            (
                "value" ->> 'valueBoolean' IS NOT NULL
                AND jsonb_typeof("value" -> 'valueBoolean') = 'boolean'
            )
            OR
            (
                "value" ->> 'valueOption' IS NOT NULL
                AND jsonb_typeof("value" -> 'valueOption') = 'string'
            )
            OR
            (
                "value" ->> 'valueDate' IS NOT NULL
                AND "value" ->> 'valueDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$' -- Check for ISO 8601 date format
            )
        )
    )
);


