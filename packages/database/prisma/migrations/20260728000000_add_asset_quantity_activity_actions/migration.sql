-- Add ActivityAction values for quantity-ledger events (asset edit form /
-- CSV import quantity + minQuantity changes now emit structured events).
-- ALTER TYPE ... ADD VALUE is additive-only, matching the enum's
-- "never rename or remove" contract in schema.prisma.
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_QUANTITY_CHANGED';
ALTER TYPE "ActivityAction" ADD VALUE 'ASSET_MIN_QUANTITY_CHANGED';
