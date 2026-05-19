---
description: User-supplied entity IDs must be org-validated before connect/read/mutate (multi-tenant IDOR guard)
globs:
  [
    "apps/webapp/app/modules/**/*.ts",
    "apps/webapp/app/routes/**/*.ts",
    "apps/webapp/app/routes/**/*.tsx",
  ]
---

# Org-Scope User-Supplied IDs

Shelf is multi-tenant. Any entity ID that originates from request/form input
and is then `connect`-ed, read, updated, or deleted MUST be proven to belong
to the caller's `organizationId` first — otherwise it is a cross-org IDOR
(an attacker in Org A supplies Org B's IDs). This applies to **create paths
too**, not just edit paths (the original bug: edit validated, create did not).

Use the shared guards in `~/utils/org-validation.server` — never re-implement
the check inline or in a feature module. If a model has no guard yet, add one
**there** (not in a service file): `assertAssetsBelongToOrg`,
`assertTagsBelongToOrg`, `assertTeamMemberBelongsToOrg`,
`assertCategoryBelongsToOrg`, `assertLocationBelongsToOrg`, …

Pass the active `tx` so validation commits atomically with the mutation.
Make `organizationId` a **required** typed param on the service function so
the compiler forces every call site to supply it.

```typescript
// ❌ Bad — connects/reads IDs from input with no org check
dataToCreate.assets = { connect: assetIds.map((id) => ({ id })) };
const loc = await db.location.findFirst({ where: { id: newLocationId } });

// ✅ Good — assert ownership first (inside the tx), then proceed
await assertAssetsBelongToOrg({ assetIds, organizationId }, tx);
await assertLocationBelongsToOrg(
  { locationId: newLocationId, organizationId },
  tx
);
```

When you fix one occurrence, grep sibling create/update/bulk handlers of the
same and related entities — this bug class travels in packs.
