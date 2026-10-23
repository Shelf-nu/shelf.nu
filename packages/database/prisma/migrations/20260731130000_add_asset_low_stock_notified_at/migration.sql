-- Debounce marker for low-stock alerting.
--
-- Set when a QUANTITY_TRACKED asset's available quantity first crosses to/below
-- its minQuantity threshold (alert emitted); cleared when it recovers above.
-- Prevents re-alerting on every subsequent decrement while already low.
--
-- Nullable, additive, no backfill — safe at Shelf's table scale, no lock concern.
ALTER TABLE "Asset" ADD COLUMN "lowStockNotifiedAt" TIMESTAMP(3);
