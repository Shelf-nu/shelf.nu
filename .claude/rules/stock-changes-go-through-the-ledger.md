---
description: Every write to a pool's total or manual placements records stock ledger rows
paths:
  - "apps/webapp/app/modules/**/*.server.ts"
  - "apps/webapp/app/routes/api+/**/*.ts"
---

# Stock Changes Go Through The Ledger

`ConsumptionLog.stockChange` rows must sum to every quantity-tracked asset's
live stock, per location, unplaced and in total. A write to `Asset.quantity`
or a manual `AssetLocation` (`assetKitId IS NULL`) without ledger rows breaks
that sum silently: nothing throws, only a stock report is wrong.

After the asset lock and before the first write, read the stock; after the
last write, record it with the events you performed:

```ts
// ❌ Bad: the placement moves, the ledger never hears of it
await tx.assetLocation.update({ where: { id }, data: { quantity: 4 } });

// ✅ Good
const before = await readStockState(tx, { assetId, organizationId });
await tx.assetLocation.update({ where: { id }, data: { quantity: 4 } });
await recordStockChanges(tx, {
  organizationId,
  userId,
  changes: [{ assetId, before, events: [] }],
});
```

Name each change of the total as a signed event; a pure move needs none.
CHECKOUT / RETURN change no stock and use `createConsumptionLog`, whose type
allows nothing else. Kit-driven placements stay out. Pin a new path in a CI
test (the in-memory replay in `asset/service.custody-source.test.ts`) and in
`consumption-log/stock-ledger.db.test.ts`.
