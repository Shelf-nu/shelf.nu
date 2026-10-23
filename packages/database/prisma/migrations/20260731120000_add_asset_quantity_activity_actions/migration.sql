-- Add QUANTITY_TRACKED audit-trail actions to the ActivityAction enum.
--
-- These feed the activity/reports pipeline so quantity and low-stock-threshold
-- edits are aggregatable per field (see the record-event-payload-shapes rule:
-- one event per changed field). ASSET_QUANTITY_CHANGED covers actual stock
-- movements (form edit, quick-adjust, check-in dispositions) alongside their
-- ConsumptionLog entry; ASSET_MIN_QUANTITY_CHANGED covers the low-stock
-- threshold (no stock moves, so no ConsumptionLog — event only).
--
-- Additive and idempotent (IF NOT EXISTS); no data backfill, no lock concern at
-- Shelf's table scale.
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ASSET_QUANTITY_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ASSET_MIN_QUANTITY_CHANGED';
