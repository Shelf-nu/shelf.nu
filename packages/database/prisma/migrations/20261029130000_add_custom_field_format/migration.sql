-- A TEXT custom field can be marked as holding a web link. Existing fields
-- become PLAIN, which is how they behave today, so no backfill is needed.

-- CreateEnum
CREATE TYPE "CustomFieldFormat" AS ENUM ('PLAIN', 'LINK');

-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN "format" "CustomFieldFormat" NOT NULL DEFAULT 'PLAIN';

-- Only TEXT fields can be Link fields.
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_format_needs_text"
  CHECK ("format" = 'PLAIN' OR "type" = 'TEXT');
