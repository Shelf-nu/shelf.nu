# Saved Asset Filter Presets – Database & Migration Spec

## Objective
Define the minimal persistence layer required to store private saved filter presets for the advanced asset index while keeping the door open for future expansion.

## Prisma Schema Changes
```prisma
enum AssetFilterPresetView {
  TABLE        @map("table")
  AVAILABILITY @map("availability")
}

model AssetFilterPreset {
  id             String   @id @default(cuid())
  organizationId String
  ownerId        String
  name           String
  query          String
  view           AssetFilterPresetView @default(TABLE)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  owner        User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  @@unique([organizationId, ownerId, name], map: "asset_filter_presets_owner_name_unique")
  @@index([organizationId, ownerId], map: "asset_filter_presets_owner_lookup_idx")
}
```

### Notes
- `query` stores the sanitized query string returned from `cleanParamsForCookie`, ensuring presets replay exactly what today’s URL-based workflow expects.
- `view` is backed by the `AssetFilterPresetView` enum so we only persist supported layouts (`table` or `availability`) and can evolve the enum safely in future migrations.
- No `isShared`, `mode`, or `lastUsedAt` columns in the MVP to minimize risk and writes; these can be added in future migrations when needed.

## Migration Plan
1. Update `app/database/schema.prisma` with the enum + model above (enum must appear before the model in the file so Prisma emits the correct dependency order).
2. Generate the migration with `npm run db:prepare-migration -- saved-filter-presets` and confirm the SQL creates the enum before the table, then the foreign keys in the correct order.
3. Append the standard RLS enablement statements for the new table (mirror the pattern from the latest asset-related migration) after the generated SQL before committing.
4. Run `npm run db:migrate` locally to validate the migration and regenerate the Prisma client.
5. Ensure feature-flagged code paths guard all usage so environments without the migration remain stable until deployment.

## Rollback Strategy
- Use the Prisma down migration (auto-generated) to drop the table if issues arise.
- Because the feature is behind `ENABLE_SAVED_ASSET_FILTERS`, disabling the flag prevents runtime lookups if rollback is required.

## Data Retention & Limits
- Enforce a per-user cap of 20 presets at the service layer to keep queries light and the UI manageable.
- Future retention policies (e.g., pruning unused presets) can be layered on later without schema changes.

## Open Questions
- Do we want to track usage ordering in the MVP? **Decision**: no—avoid extra writes until the feature proves value.
- Should preset names be case-insensitive? **Recommendation**: normalize via Prisma query (e.g., convert to lower case on comparison) within service logic; no additional index needed today.
