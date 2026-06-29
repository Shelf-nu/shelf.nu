-- Asset reinstate emits the ASSET_UNARCHIVED activity action. ASSET_ARCHIVED
-- already existed in the enum (pre-existing scaffolding), but ASSET_UNARCHIVED
-- is net-new, so the DB enum must learn it or activityEvent inserts fail with
-- Postgres 22P02 (invalid input value for enum). Separate migration because an
-- added enum value can't be used in the same transaction it's created in.

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ASSET_UNARCHIVED';
