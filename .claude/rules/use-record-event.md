---
description: Every state-changing mutation must call recordEvent inside the same transaction as the mutation
globs:
  [
    "apps/webapp/app/modules/**/*.ts",
    "apps/webapp/app/routes/**/*.ts",
    "apps/webapp/app/routes/**/*.tsx",
  ]
---

When a mutation writes a system note (`type: "UPDATE"`) or changes persisted
state tracked by `ActivityAction`, emit a structured event via `recordEvent`
from `~/modules/activity-event/service.server` inside the **same** Prisma
transaction. This feeds reports; it is additive to the existing note write,
not a replacement. Do not call `recordEvent` for user-authored `COMMENT`
notes or pure reads.

```typescript
// ❌ Bad — event outside the tx can be orphaned on rollback
await db.$transaction(async (tx) => {
  await updateAsset(tx, patch);
  await createNote({ ... }, tx);
});
await recordEvent({ action: "ASSET_NAME_CHANGED", ... }); // missing tx

// ✅ Good — event commits atomically with the mutation
await db.$transaction(async (tx) => {
  await updateAsset(tx, patch);
  await createNote({ ... }, tx);
  await recordEvent({
    organizationId, actorUserId: userId,
    action: "ASSET_NAME_CHANGED",
    entityType: "ASSET", entityId: assetId,
    field: "name", fromValue: before.name, toValue: after.name,
  }, tx);
});
```
