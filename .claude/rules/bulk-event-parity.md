---
description: Bulk operations must emit the same activity events as their singular counterparts, including cascade events from relation cleanup
globs: ["apps/webapp/app/modules/**/*.ts", "apps/webapp/app/routes/**/*.ts"]
---

When you add or modify a bulk operation (e.g. `bulkRemoveAssetsFromKits`,
`bulkUpdateAssetCategory`), it must emit the same `ActivityAction` events as
its singular counterpart — one event per affected entity — and include events
for **cascade side-effects** (e.g. an `onDelete: SetNull` that unkits assets,
or a kit-custody cleanup that releases asset custody). Without this, reports
silently lose rows when users switch from the singular UI to the bulk action.

Use `recordEvents` (plural) inside the same `$transaction` as the mutation.
Only emit for items that actually changed — fetch the before-state first and
skip no-op rows.

```typescript
// ❌ Bad — bulk path silently skips the events the singular path emits
async function bulkRemoveAssetsFromKits({ assetIds }) {
  await db.$transaction(async (tx) => {
    await tx.asset.updateMany({ where: ..., data: { kitId: null } });
    await tx.note.createMany({ data: ... });
    // missing: per-asset ASSET_KIT_CHANGED + CUSTODY_RELEASED (cascade)
  });
}

// ✅ Good — emit one event per affected item + cascade
async function bulkRemoveAssetsFromKits({ assetIds }) {
  const assets = await db.asset.findMany({ select: { id, kit, custody } });
  await db.$transaction(async (tx) => {
    await tx.asset.updateMany({ data: { kitId: null } });
    await recordEvents(
      assets.filter((a) => a.kit).map((a) => ({
        action: "ASSET_KIT_CHANGED", assetId: a.id,
        field: "kitId", fromValue: a.kit.id, toValue: null, ...
      })),
      tx,
    );
    // also emit CUSTODY_RELEASED for assets whose kit-custody was cleaned up
  });
}
```
