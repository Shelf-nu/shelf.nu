---
description: Emit one recordEvent per changed field and per added/removed array item — never aggregate
globs: ["apps/webapp/app/modules/**/*.ts"]
---

For `*_CHANGED` actions, write one event per logical field that actually
changed — not one umbrella event covering the whole mutation. For array
fields, use `_ADDED` / `_REMOVED` actions with one event per item. This
keeps `groupBy` / `count` aggregations possible without JSON parsing.

```typescript
// ❌ Bad — aggregate event; reports can't count "how often did valuation change?"
await recordEvent({
  action: "ASSET_UPDATED",
  meta: { name: [oldName, newName], valuation: [oldVal, newVal] },
}, tx);

// ✅ Good — one event per field that changed
if (before.name !== after.name) {
  await recordEvent({
    action: "ASSET_NAME_CHANGED",
    field: "name", fromValue: before.name, toValue: after.name, ...
  }, tx);
}
if (before.valuation !== after.valuation) { /* ASSET_VALUATION_CHANGED */ }

// ❌ Bad — whole array in toValue
await recordEvent({ action: "BOOKING_ASSETS_CHANGED", toValue: newAssetIds }, tx);

// ✅ Good — one event per added/removed item (use recordEvents for bulk insert)
await recordEvents(
  addedAssetIds.map((assetId) => ({
    action: "BOOKING_ASSETS_ADDED", bookingId, assetId, ...
  })),
  tx,
);
```
