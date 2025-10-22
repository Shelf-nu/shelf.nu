# Select All Pattern

This guide documents the "Select All" pattern used in Shelf.nu for bulk operations across multiple pages of filtered data.

## Overview

The `ALL_SELECTED_KEY` pattern enables users to select **all items matching current filters**, even when those items span multiple pages. This is critical for bulk operations like:

- Exporting filtered assets
- Bulk deleting assets
- Generating QR codes for multiple assets
- Exporting bookings
- Exporting team members (NRMs)

## The Problem

When a user has:

1. Active filters applied (e.g., category, location, tags, search)
2. Multiple pages of results
3. Clicks "Select All"

We need to:

- Include **all matching items**, not just the current page
- Respect **all active filters** from the index page
- Pass filter context from the UI to the backend

## The Solution: ALL_SELECTED_KEY

Located in `app/utils/list.ts`:

```typescript
export const ALL_SELECTED_KEY = "all-selected";

export function isSelectingAllItems(selectedItems: ListItemData[]) {
  return !!selectedItems.find((item) => item.id === ALL_SELECTED_KEY);
}
```

When the user clicks "Select All", `ALL_SELECTED_KEY` is added to the selected items array. This signals to backend logic that we need to fetch **all items matching the current filters**.

## Implementation Pattern

### Three-Layer Architecture

Every bulk operation using `ALL_SELECTED_KEY` follows this pattern:

```
1. Component Layer (Button/Form)
   ↓ Passes: assetIds + currentSearchParams
2. Route/API Layer (Loader/Action)
   ↓ Fetches settings + Extracts and forwards parameters
3. Service Layer (Business Logic)
   ↓ Uses resolveAssetIdsForBulkOperation helper (handles both simple & advanced mode)
```

### Important: Simple vs Advanced Mode

Shelf has two index modes that require different filtering approaches:

- **Simple Mode**: Uses Prisma where clauses (`Prisma.AssetWhereInput`)
- **Advanced Mode**: Uses raw SQL queries with filter parsing

The `resolveAssetIdsForBulkOperation` helper (see below) handles both modes automatically, ensuring consistent behavior across all bulk operations.

### 1. Component Layer: Pass Search Params

**Key Requirements:**

- Use `useSearchParams()` hook to capture current URL state
- Pass `currentSearchParams` alongside selected IDs
- Only pass search params when `ALL_SELECTED_KEY` is present

**Example:** `app/components/assets/assets-index/export-assets-button.tsx`

```typescript
import { useSearchParams } from "~/hooks/search-params";
import { isSelectingAllItems, ALL_SELECTED_KEY } from "~/utils/list";

export function ExportAssetsButton() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const [searchParams] = useSearchParams();
  const allSelected = isSelectingAllItems(selectedAssets);

  // Get the assetIds from the atom
  const assetIds = selectedAssets.map((asset) => asset.id);

  // Build search params including current filters
  const exportSearchParams = new URLSearchParams();
  if (assetIds.length > 0) {
    exportSearchParams.set("assetIds", assetIds.join(","));
  }

  // If all are selected, pass current search params to apply filters
  if (allSelected) {
    exportSearchParams.set(
      "assetIndexCurrentSearchParams",
      searchParams.toString()
    );
  }

  const handleExport = async () => {
    const response = await fetch(
      `/assets/export/filename.csv?${exportSearchParams.toString()}`
    );
    // ... handle download
  };
}
```

### 2. Route/API Layer: Extract and Forward

**Key Requirements:**

- Extract both `assetIds` and `currentSearchParams` from request
- **Fetch asset index settings** using `getAssetIndexSettings`
- Use `canUseBarcodes` from `requirePermission` (don't access `currentOrganization.barcodesEnabled`)
- Pass settings to service layer functions
- Use a descriptive parameter name (e.g., `currentSearchParams`)

**Example:** `app/routes/api+/assets.bulk-mark-availability.ts`

```typescript
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  // Get canUseBarcodes directly from requirePermission
  const { organizationId, canUseBarcodes } = await requirePermission({
    request,
    userId,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

  // Fetch asset index settings to determine mode (SIMPLE or ADVANCED)
  const settings = await getAssetIndexSettings({
    userId,
    organizationId,
    canUseBarcodes, // Use from requirePermission, not currentOrganization.barcodesEnabled
  });

  const { assetIds, type, currentSearchParams } = parseData(
    await request.formData(),
    BulkMarkAvailabilitySchema.and(CurrentSearchParamsSchema)
  );

  await bulkMarkAvailability({
    organizationId,
    assetIds,
    type,
    currentSearchParams, // Pass filter context
    settings, // Pass settings for mode detection
  });

  return json(data({ success: true }));
}
```

**Important Notes:**

- ✅ Always use `canUseBarcodes` from `requirePermission`
- ❌ Never use `currentOrganization.barcodesEnabled`
- ✅ Fetch settings in every route that does bulk operations
- ✅ Pass `settings` to service functions for mode detection

### 3. Service Layer: Use the Helper Function

**Key Requirements:**

- Use `resolveAssetIdsForBulkOperation` helper to resolve IDs
- Import the helper at the **top of the file** (no dynamic imports)
- Pass `assetIds`, `organizationId`, `currentSearchParams`, and `settings`
- The helper automatically handles both Simple and Advanced modes
- Use resolved IDs in your bulk operations

**Example:** `app/modules/asset/service.server.ts`

```typescript
// ✅ Import at top of file
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";

export async function bulkMarkAvailability({
  organizationId,
  assetIds,
  type,
  currentSearchParams,
  settings,
}: {
  organizationId: Asset["organizationId"];
  assetIds: Asset["id"][];
  type: "available" | "unavailable";
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Step 1: Resolve IDs using the helper (handles both modes)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    // Step 2: Use resolved IDs in your bulk operation
    await db.asset.updateMany({
      where: {
        id: { in: resolvedIds },
        organizationId,
        availableToBook: type === "unavailable",
      },
      data: { availableToBook: type === "available" },
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update asset availability",
      additionalData: { assetIds, organizationId, type },
      label: "Assets",
    });
  }
}
```

**Important: No Dynamic Imports**

```typescript
// ❌ WRONG - Do not use dynamic imports
const { resolveAssetIdsForBulkOperation } = await import(
  "./bulk-operations-helper.server"
);

// ✅ CORRECT - Import at top of file
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
```

## Helper Functions

### resolveAssetIdsForBulkOperation

**Location:** `app/modules/asset/bulk-operations-helper.server.ts`

This is the **main helper** for all bulk operations. It automatically handles both Simple and Advanced modes.

```typescript
export async function resolveAssetIdsForBulkOperation({
  assetIds,
  organizationId,
  currentSearchParams,
  settings,
}: {
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}): Promise<string[]> {
  // Case 1: Specific selection - return IDs as-is
  if (!assetIds.includes(ALL_SELECTED_KEY)) {
    return assetIds;
  }

  // Case 2: Select all - resolve based on mode
  const isAdvancedMode = settings.mode === "ADVANCED";

  if (isAdvancedMode && currentSearchParams) {
    // Advanced mode: Use raw SQL with filter parsing
    return getAdvancedFilteredAssetIds({
      organizationId,
      currentSearchParams,
      settings,
    });
  } else {
    // Simple mode: Use Prisma where clause
    const where = getAssetsWhereInput({
      organizationId,
      currentSearchParams,
    });

    const assets = await db.asset.findMany({
      where,
      select: { id: true },
    });

    return assets.map((a) => a.id);
  }
}
```

**How it works:**

1. If `ALL_SELECTED_KEY` is **not** present → returns the provided IDs directly
2. If `ALL_SELECTED_KEY` **is** present → resolves all matching IDs:
   - **Advanced mode**: Uses `getAdvancedFilteredAssetIds` with raw SQL
   - **Simple mode**: Uses `getAssetsWhereInput` with Prisma

**Benefits:**

- ✅ Single source of truth for ID resolution
- ✅ Handles both modes automatically
- ✅ Compatible with `updateMany`, `deleteMany`, etc.
- ✅ Consistent behavior across all bulk operations

### getAssetsWhereInput

**Location:** `app/modules/asset/utils.server.ts`

This function builds a Prisma where clause from URL search parameters (used in **Simple mode**):

```typescript
export function getAssetsWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
}) {
  const where: Prisma.AssetWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);
  const paramsValues = getParamsValues(searchParams);
  const { categoriesIds, locationIds, tagsIds, search, teamMemberIds } =
    paramsValues;

  // Apply filters to where clause
  if (search) {
    where.title = {
      contains: search.toLowerCase().trim(),
      mode: "insensitive",
    };
  }

  if (categoriesIds && categoriesIds.length > 0) {
    where.categoryId = { in: categoriesIds };
  }

  // ... more filter logic

  return where;
}
```

**Supports filters for:**

- Text search
- Categories (including "uncategorized")
- Tags (including "untagged")
- Locations (including "without-location")
- Team members / custodians
- Status

## Existing Implementations

All asset bulk operations now use the `resolveAssetIdsForBulkOperation` helper pattern:

### Asset Bulk Operations (Using Helper)

All these operations follow the same pattern shown above:

1. **bulkMarkAvailability** - Mark assets as available/unavailable

   - Route: `app/routes/api+/assets.bulk-mark-availability.ts`
   - Service: `app/modules/asset/service.server.ts`

2. **bulkUpdateAssetLocation** - Update location for multiple assets

   - Route: `app/routes/api+/assets.bulk-update-location.ts`
   - Service: `app/modules/asset/service.server.ts`

3. **bulkUpdateAssetCategory** - Update category for multiple assets

   - Route: `app/routes/api+/assets.bulk-update-category.ts`
   - Service: `app/modules/asset/service.server.ts`

4. **bulkAssignAssetTags** - Assign/remove tags for multiple assets

   - Route: `app/routes/api+/assets.bulk-assign-tags.ts`
   - Service: `app/modules/asset/service.server.ts`

5. **bulkCheckOutAssets** (bulkAssignCustody) - Assign custody

   - Route: `app/routes/api+/assets.bulk-assign-custody.ts`
   - Service: `app/modules/asset/service.server.ts`

6. **bulkCheckInAssets** (bulkReleaseCustody) - Release custody

   - Route: `app/routes/api+/assets.bulk-release-custody.ts`
   - Service: `app/modules/asset/service.server.ts`

7. **bulkRemoveAssetsFromKits** - Remove assets from kits

   - Route: `app/routes/api+/assets.bulk-remove-from-kits.ts`
   - Service: `app/modules/kit/service.server.ts`

8. **bulkDeleteAssets** - Delete multiple assets
   - Route: `app/routes/_layout+/assets._index.tsx` (action)
   - Route: `app/routes/_layout+/admin-dashboard+/org.$organizationId.assets.tsx` (action)
   - Service: `app/modules/asset/service.server.ts`

### Other Select All Implementations

These use different patterns appropriate to their use case:

- **Export Assets** - Uses advanced filtering directly

  - Button: `app/components/assets/assets-index/export-assets-button.tsx`
  - Route: `app/routes/_layout+/assets.export.$fileName[.csv].tsx`
  - Service: `app/utils/csv.server.ts` → `exportAssetsFromIndexToCsv`

- **Bulk QR Code Download** - Uses `getAssetsWhereInput` directly

  - API: `app/routes/api+/assets.get-assets-for-bulk-qr-download.ts`

- **Export Bookings**

  - Button: `app/components/booking/export-bookings-button.tsx`
  - Service: `app/utils/csv.server.ts` → `exportBookingsFromIndexToCsv`

- **Export Team Members (NRMs)**
  - Button: `app/components/nrm/export-nrm-button.tsx`
  - Service: `app/utils/csv.server.ts` → `exportNRMsToCsv`

## Common Pitfalls

### ❌ Pitfall 1: Not Passing Search Params

**Symptom:** When "Select All" is used, all organization items are exported/affected, ignoring filters.

**Cause:** Only passing `assetIds` without `currentSearchParams`.

**Fix:** Always pass search params when `ALL_SELECTED_KEY` is present:

```typescript
// ❌ Wrong
const url = `/export?assetIds=${assetIds.join(",")}`;

// ✅ Correct
if (allSelected) {
  exportSearchParams.set("currentSearchParams", searchParams.toString());
}
```

### ❌ Pitfall 2: Using Stale Cookie Filters

**Symptom:** Export uses old filters from previous page visits.

**Cause:** Relying on cookies instead of explicit URL params.

**Fix:** Pass explicit search params for "Select All" operations:

```typescript
// ✅ Use explicit params when selecting all
const filtersToUse =
  takeAll && currentSearchParams
    ? currentSearchParams // Use current page state
    : cachedFilters; // Fall back to cookies for normal operations
```

### ❌ Pitfall 3: Forgetting takeAll Flag

**Symptom:** Query limited to current page even with filters applied.

**Cause:** Not setting `takeAll` flag or not removing pagination.

**Fix:** Pass `takeAll` to service functions:

```typescript
const { assets } = await getAdvancedPaginatedAndFilterableAssets({
  // ... other params
  takeAll, // Removes LIMIT/OFFSET from query
  assetIds: takeAll ? undefined : ids, // Only use specific IDs when not taking all
});
```

## Performance Considerations

### Why Pass Search Params Explicitly?

1. **Correctness** - Guarantees filter state matches what user sees
2. **Performance** - Skips async cookie parsing when params are available
3. **Reliability** - Works with SPA navigation, bookmarked URLs, browser history

### Query Optimization

When `takeAll` is true:

- Remove `LIMIT` and `OFFSET` from queries
- Still apply `WHERE` filters to narrow results
- Consider adding progress indicators for large datasets

```typescript
const paginationClause = takeAll
  ? Prisma.empty
  : Prisma.sql`LIMIT ${take} OFFSET ${skip}`;
```

## Testing Checklist

When implementing a new bulk operation with Select All:

- [ ] Filters are applied correctly when selecting all
- [ ] Works with multi-page datasets
- [ ] Respects search text filter
- [ ] Respects dropdown filters (category, location, tags, etc.)
- [ ] Works with combined filters
- [ ] Handles "uncategorized", "untagged", "without-location" special cases
- [ ] Performance is acceptable with large datasets
- [ ] Error handling for failed operations

## Quick Reference

### Minimal Implementation Checklist

**1. Component/Button:**

```typescript
const [searchParams] = useSearchParams();
const allSelected = isSelectingAllItems(selectedItems);

if (allSelected) {
  params.set("currentSearchParams", searchParams.toString());
}
```

**2. Route/API:**

```typescript
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";

// Get canUseBarcodes from requirePermission
const { organizationId, canUseBarcodes } = await requirePermission({...});

// Fetch settings
const settings = await getAssetIndexSettings({
  userId,
  organizationId,
  canUseBarcodes,
});

// Extract params
const { assetIds, currentSearchParams } = parseData(formData, schema);

// Pass to service
await bulkOperation({
  assetIds,
  organizationId,
  currentSearchParams,
  settings,
});
```

**3. Service:**

```typescript
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";

// Resolve IDs (handles both Simple and Advanced mode)
const resolvedIds = await resolveAssetIdsForBulkOperation({
  assetIds,
  organizationId,
  currentSearchParams,
  settings,
});

// Use resolved IDs in your operation
await db.asset.updateMany({
  where: { id: { in: resolvedIds }, organizationId },
  data: {
    /* your updates */
  },
});
```

## Related Documentation

- [Advanced Filtering Guide](./advanced-index/advanced-filtering-guide.md)
- [Handling Errors](./handling-errors.md)
- [Asset Index Settings](./advanced-index/asset-index-settings.md)

## Questions or Issues?

If you encounter issues with the Select All pattern:

1. Check existing implementations for reference
2. Verify all three layers are properly connected
3. Ensure search params are being passed through the chain
4. Test with actual filters applied across multiple pages
