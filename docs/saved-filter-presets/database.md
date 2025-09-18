# Saved Asset Filter Presets – Database & Migration Spec

## Objective
Define the persistent data structures needed to store and manage saved filter presets for the advanced asset index while minimizing risk to existing data flows.

## Prisma Schema Changes
```prisma
model AssetFilterPreset {
  id              String   @id @default(cuid())
  organizationId  String
  ownerId         String
  name            String
  query           String
  view            String
  mode            AssetFilterPresetMode @default(ADVANCED)
  isShared        Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastUsedAt      DateTime?

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  owner        User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@unique([organizationId, ownerId, name], map: "asset_filter_presets_owner_name_unique")
  @@index([organizationId, isShared], map: "asset_filter_presets_org_shared_idx")
  @@index([organizationId, lastUsedAt], map: "asset_filter_presets_last_used_idx")
}

enum AssetFilterPresetMode {
  ADVANCED
  SIMPLE
}
```

### Notes
- `mode` enum is future-proofing for simple index presets without requiring a breaking schema change.
- `view` stores the current layout (`table`, `availability`, etc.).
- `query` contains the sanitized query string (canonical `URLSearchParams` order) returned from `cleanParamsForCookie`.
- `lastUsedAt` enables analytics-based ordering; nullable to avoid writes until first apply.

## Migration Plan
1. Generate migration script with `npm run db:prepare-migration -- saved-filter-presets`.
2. Verify generated SQL adds enum before model to satisfy Postgres dependency order.
3. Confirm indexes are created with descriptive names to avoid collisions.
4. Run migration locally via `npm run db:migrate` after updating Prisma client.
5. Backfill is not required; table starts empty.

## Rollback Strategy
- Use Prisma migration down script (auto-generated) to drop table and enum.
- Confirm dependent code is behind feature flag `ENABLE_SAVED_ASSET_FILTERS` to prevent runtime errors if rollback occurs.

## Data Retention & Limits
- Enforce application-level limit of 20 presets per user to reduce storage and UI clutter.
- Consider background job to prune presets not used for >365 days (future enhancement).

## Open Questions
- Should `query` be compressed or stored as JSON for readability? **Decision**: keep string to align with existing URL-based workflow.
- Do we need multi-owner relationships for shared presets? **Decision**: not for MVP; `isShared` flag suffices.
