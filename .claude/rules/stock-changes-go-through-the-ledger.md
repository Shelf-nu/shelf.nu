---
description: Every write to a pool's total or manual placements records stock ledger rows
globs: apps/webapp/app/modules/**/*.server.ts,apps/webapp/app/routes/api+/**/*.ts
---

# Stock Changes Go Through The Ledger

The stock ledger (`ConsumptionLog.stockChange`) must sum to the live stock of
every quantity-tracked asset: per location, unplaced, and in total. A write
that changes `Asset.quantity` or a manual `AssetLocation` row (`assetKitId IS
NULL`) without ledger rows breaks that sum for good, silently: nothing throws,
every screen still renders, and only a per-location stock report is wrong.

In the transaction, after the asset lock and before the first write, read the
stock; after the last write, record it with the events you performed:

```ts
// ❌ Bad: the placement moves, the ledger never hears of it
await tx.assetLocation.update({ where: { id }, data: { quantity: 4 } });

// ✅ Good
const before = await readStockState(tx, { assetId, organizationId });
await tx.assetLocation.update({ where: { id }, data: { quantity: 4 } });
await recordStockChanges(tx, {
  organizationId,
  userId,
  changes: [{ assetId, before, events: [] }], // no total change: a MOVE
});
```

Name every change of the total as an event (`{ category, change }`, signed);
units that only changed place need none. Rows come from the before/after
diff, so the reconcile, trims and re-homes are covered. Hand-outs and returns
(CHECKOUT, RETURN) change no stock and use `createConsumptionLog`, which
refuses every other category.

Prove a new path with `consumption-log/stock-ledger.db.test.ts`: add the
change there and check the replay. Kit-driven placements are a separate axis
and stay out of the ledger.
