-- The stock ledger records every change to a quantity-tracked asset's stock,
-- with the location it happened at, so a report can sum it per location.
--
-- "ConsumptionLog"."stockChange" is the signed change a row made to the stock
-- at its location (NULL location = the unplaced units): positive in, negative
-- out, 0 for a hand-out or return that changes no stock. NULL on rows written
-- before this column existed; those keep whatever location they had.
--
-- "Asset"."stockLedgerStartedAt" marks the moment the rows of a pool start
-- summing to its live stock: its creation (INITIAL rows), or its first stock
-- change after this release (OPENING_BALANCE rows, read from the live
-- placements under the asset lock at that moment).
--
-- New categories:
--   MOVE            units moved between locations or to/from the unplaced
--                   units; one row per side, the total does not change.
--   INITIAL         the stock an asset was created with.
--   OPENING_BALANCE the stock a pool held when its ledger started.
--
-- No backfill. Old rows cannot say where their units were, and nothing needs
-- them to: each pool's opening balance is taken when it next changes.
--
-- Additive only. The new enum values are not used in this file, so the
-- ADD VALUE statements are safe in the migration's transaction (Postgres 12+).
--
-- Apply BEFORE deploying the code: Prisma reads every scalar column of
-- "Asset" and "ConsumptionLog" on queries without a select, so code that
-- knows these columns fails against a database that lacks them.

ALTER TYPE "ConsumptionCategory" ADD VALUE IF NOT EXISTS 'MOVE';
ALTER TYPE "ConsumptionCategory" ADD VALUE IF NOT EXISTS 'INITIAL';
ALTER TYPE "ConsumptionCategory" ADD VALUE IF NOT EXISTS 'OPENING_BALANCE';

ALTER TABLE "ConsumptionLog" ADD COLUMN "stockChange" INTEGER;

ALTER TABLE "Asset" ADD COLUMN "stockLedgerStartedAt" TIMESTAMP(3);
