-- Gives the custodian the whole pool on quantity-tracked assets that were
-- created with a custodian (CSV import, content import) and got the column
-- default of 1 unit in custody. Creating one now writes the full quantity,
-- so this brings the rows written before in line.
--
-- Only rows that can be told apart from a deliberate 1-unit custody, on an
-- asset nothing has happened to since it was created:
--   - an operator custody row (no kit custody) of exactly 1 unit, on a pool
--     of more than 1;
--   - the asset's only custody row, and the asset is in no kit, so the whole
--     pool is free to hand over;
--   - the asset's ledger holds nothing but its starting stock. Assigning,
--     returning or using up custody by hand always writes a ConsumptionLog
--     row, and so does a restock or an adjustment, so any such row means
--     the 1 unit may be intended or the total has changed;
--   - no units are out on a booking.
--
-- Safe to run more than once: a row it has changed no longer has quantity 1.
UPDATE "Custody" c
SET "quantity" = a."quantity",
    "updatedAt" = NOW()
FROM "Asset" a
WHERE a."id" = c."assetId"
  AND a."type" = 'QUANTITY_TRACKED'
  AND a."quantity" > 1
  AND c."quantity" = 1
  AND c."kitCustodyId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Custody" o
    WHERE o."assetId" = c."assetId" AND o."id" <> c."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "AssetKit" ak WHERE ak."assetId" = c."assetId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ConsumptionLog" l
    WHERE l."assetId" = c."assetId"
      AND l."category" NOT IN ('INITIAL', 'OPENING_BALANCE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "BookingAsset" ba
    WHERE ba."assetId" = c."assetId"
      AND ba."checkedOutAt" IS NOT NULL
      AND ba."checkedInAt" IS NULL
  );
