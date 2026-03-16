# Prisma → Supabase Migration Progress

**Strategy**: All complex patterns are migrated using **Postgres functions + Supabase RPC**.

- Transactions → Postgres function with BEGIN/COMMIT, called via `sbDb.rpc()`
- Raw SQL → Wrap existing SQL in Postgres function, call via RPC
- Nested includes → Simple: PostgREST select syntax. Complex: Postgres function + RPC

---

## Phase 1: Raw SQL (`$queryRaw` / `$executeRaw`)

Already SQL — just wrap in Postgres functions.

| #   | Module                         | Function                                  | Status                         |
| --- | ------------------------------ | ----------------------------------------- | ------------------------------ |
| 1   | asset/sequential-id            | `createOrganizationSequence`              | ✅                             |
| 2   | asset/sequential-id            | `resetOrganizationSequence`               | ✅                             |
| 3   | asset/sequential-id            | `getNextSequentialId`                     | ✅                             |
| 4   | asset/sequential-id            | `generateBulkSequentialIdsEfficient`      | ✅                             |
| 5   | asset/sequential-id            | `estimateNextSequentialId`                | ✅                             |
| 6   | asset/sequential-id            | `organizationHasSequentialIds`            | ✅                             |
| 7   | asset/sequential-id            | `getAssetsWithoutSequentialIdCount`       | ✅                             |
| 8   | location                       | `getLocationDescendantsTree` (CTE)        | ✅                             |
| 9   | location                       | `getLocationHierarchy` (CTE)              | ✅                             |
| 10  | location                       | `getLocationSubtreeDepth` (CTE)           | ✅                             |
| 11  | location                       | `getLocationDescendantIds` (CTE)          | ✅                             |
| 12  | auth                           | `confirmExistingAuthAccount`              | ✅                             |
| 13  | auth                           | `validateSession`                         | ✅                             |
| 14  | custom-field                   | `getFilteredAndPaginatedCustomFields`     | ✅                             |
| 15  | user                           | `revokeUserOrganizationAccess` cleanup    | ✅                             |
| 16  | asset-index-settings           | `removeCustomFieldFromAssetIndexSettings` | ✅                             |
| 17  | asset (bulk-operations-helper) | `getAdvancedFilteredAssetIds`             | ⏳ Dynamic SQL, deferred       |
| 18  | asset                          | `getPaginatedAndFilterableAssets`         | ⏳ Dynamic SQL, deferred       |
| 19  | booking                        | `bulkInsertBookingAssets`                 | ⏳ Inside transaction, Phase 2 |

## Phase 2: Transactions (`db.$transaction`)

Each becomes a Postgres function wrapping multiple operations atomically.

| #   | Module               | Function                              | Status |
| --- | -------------------- | ------------------------------------- | ------ |
| 1   | booking              | `checkoutBooking`                     | ⬜     |
| 2   | booking              | `checkinBooking`                      | ⬜     |
| 3   | booking              | `partialCheckinBooking`               | ⬜     |
| 4   | booking              | `revertBooking`                       | ⬜     |
| 5   | booking              | `extendBooking`                       | ⬜     |
| 6   | booking              | `bulkDeleteBookings`                  | ⬜     |
| 7   | booking              | `bulkArchiveBookings`                 | ⬜     |
| 8   | booking              | `bulkCancelBookings`                  | ⬜     |
| 9   | booking              | `updateBookingAssetStates`            | ⬜     |
| 10  | booking              | `addScannedAssetsToBooking`           | ⬜     |
| 11  | audit                | `createAuditSession`                  | ⬜     |
| 12  | audit                | `updateAuditSession`                  | ⬜     |
| 13  | audit                | `completeAuditSession`                | ⬜     |
| 14  | audit                | `recordAuditScan`                     | ⬜     |
| 15  | audit                | `addAssetsToAudit`                    | ⬜     |
| 16  | audit                | `removeAssetsFromAudit`               | ⬜     |
| 17  | audit                | `resolveAuditAssignment`              | ⬜     |
| 18  | kit                  | `releaseCustody`                      | ⬜     |
| 19  | kit                  | `bulkDeleteKits`                      | ⬜     |
| 20  | kit                  | `bulkAssignCustody`                   | ⬜     |
| 21  | kit                  | `bulkReleaseCustody`                  | ⬜     |
| 22  | kit                  | `updateKitAssets`                     | ⬜     |
| 23  | kit                  | `editKitAssets`                       | ⬜     |
| 24  | asset                | `bulkCheckOutAssets`                  | ⬜     |
| 25  | asset                | `bulkCheckInAssets`                   | ⬜     |
| 26  | asset                | `bulkUpdateLocation`                  | ⬜     |
| 27  | user                 | `createUserOrAttachOrg`               | ⬜     |
| 28  | user                 | `revokeAccessEmailSent` / soft delete | ⬜     |
| 29  | organization         | `transferOwnership`                   | ⬜     |
| 30  | invite               | `bulkInviteUsers`                     | ⬜     |
| 31  | asset-filter-presets | `createFilterPreset`                  | ⬜     |
| 32  | asset-filter-presets | `renameFilterPreset`                  | ⬜     |
| 33  | custom-field         | `deleteCustomField` (soft)            | ⬜     |
| 34  | update               | `markAllUpdatesAsRead`                | ⬜     |

## Phase 3: Nested Includes / Complex Prisma Patterns

Simple joins → PostgREST select syntax. Complex → Postgres function + RPC.

| #   | Module         | Function / Constant                       | Pattern                             | Status |
| --- | -------------- | ----------------------------------------- | ----------------------------------- | ------ |
| 1   | asset          | `getAsset`                                | Generic `Prisma.AssetInclude`       | ⬜     |
| 2   | asset          | `getAssets`                               | Complex where with relation filters | ⬜     |
| 3   | asset          | `ASSET_BEFORE_UPDATE_SELECT`              | Nested select                       | ⬜     |
| 4   | asset          | `setKitCustodyAfterAssetImport`           | Nested create/connect               | ⬜     |
| 5   | asset          | `validateKitCustodyConflicts`             | Deep nested select                  | ⬜     |
| 6   | booking        | `createBooking`                           | Multiple nested connect             | ⬜     |
| 7   | booking        | `updateBasicBooking`                      | Deep nested select                  | ⬜     |
| 8   | booking        | `BOOKING_COMMON_INCLUDE` etc.             | Complex include constants           | ⬜     |
| 9   | kit            | `createKit`                               | Nested create with connect          | ⬜     |
| 10  | kit            | `updateKit`                               | connect/disconnect                  | ⬜     |
| 11  | kit            | `getPaginatedAndFilterableKits`           | Generic include, some/none/every    | ⬜     |
| 12  | user           | `getUserByID`                             | Generic overloads                   | ⬜     |
| 13  | user           | `getUserWithContact`                      | Nested include                      | ⬜     |
| 14  | organization   | `getOrganizationById`                     | Generic include                     | ⬜     |
| 15  | organization   | `getOrganizationsBySsoDomain`             | Nested include with isNot           | ⬜     |
| 16  | organization   | `createOrganization`                      | Multiple nested creates             | ⬜     |
| 17  | team-member    | `getTeamMember`                           | Generic overloads                   | ⬜     |
| 18  | team-member    | `bulkDeleteNRMs`                          | Nested select with count            | ⬜     |
| 19  | location       | `getLocation`                             | Multi-level nested include          | ⬜     |
| 20  | invite         | `createInvite`                            | Nested connect                      | ⬜     |
| 21  | invite         | `updateInviteStatus`                      | Nested connect + updateMany         | ⬜     |
| 22  | invite         | `getPaginatedAndFilterableSettingInvites` | groupBy + distinct                  | ⬜     |
| 23  | custom-field   | `createCustomField`                       | connect on categories               | ⬜     |
| 24  | custom-field   | `getCustomField`                          | Generic include                     | ⬜     |
| 25  | settings       | `getPaginatedAndFilterableSettingUsers`   | Nested include with \_count         | ⬜     |
| 26  | custody        | `releaseCustody`                          | Nested delete + include             | ⬜     |
| 27  | asset-reminder | `createAssetReminder`                     | connect on teamMembers              | ⬜     |
| 28  | audit          | `AUDIT_LIST_INCLUDE`                      | \_count aggregation                 | ⬜     |

---

## Migration File Tracking

Each Postgres function needs a Supabase migration file in `packages/database/prisma/migrations/`.

| Migration file                              | Functions included                                                                              | Status     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| `20260316211631_add_supabase_rpc_functions` | Sequential ID (7), Location (4), Auth (2), Custom Field (1), User (1), Asset Index Settings (1) | ✅ Created |

---

## Notes

- All Postgres functions are created via Supabase migrations (SQL files)
- RPC calls use `sbDb.rpc('function_name', { params })`
- Return types from RPC need TypeScript type definitions
- Test each function after migration
- Keep Prisma fallback available during migration (don't remove imports until verified)
