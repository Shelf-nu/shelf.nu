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
   ↓ Extracts and forwards parameters
3. Service Layer (Business Logic)
   ↓ Builds where clause with getAssetsWhereInput
```

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
- Pass both to service layer functions
- Use a descriptive parameter name (e.g., `assetIndexCurrentSearchParams`)

**Example:** `app/routes/_layout+/assets.export.$fileName[.csv].tsx`

```typescript
export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const searchParams = getCurrentSearchParams(request);
  const assetIds = searchParams.get("assetIds");
  const assetIndexCurrentSearchParams = searchParams.get(
    "assetIndexCurrentSearchParams"
  );

  const csvString = await exportAssetsFromIndexToCsv({
    request,
    assetIds,
    settings,
    currentOrganization,
    assetIndexCurrentSearchParams, // Pass filter context
  });

  return new Response(csvString, {
    status: 200,
    headers: { "content-type": "text/csv" },
  });
};
```

### 3. Service Layer: Build Where Clause

**Key Requirements:**

- Check if `assetIds` includes `ALL_SELECTED_KEY`
- When true, use `currentSearchParams` to build filter where clause
- Use `getAssetsWhereInput` helper (or equivalent for other entities)
- When false, use specific IDs only

**Example:** `app/utils/csv.server.ts`

```typescript
import { ALL_SELECTED_KEY } from "./list";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";

export async function exportAssetsFromIndexToCsv({
  request,
  assetIds,
  settings,
  currentOrganization,
  assetIndexCurrentSearchParams,
}: {
  request: Request;
  assetIds: string;
  settings: AssetIndexSettings;
  currentOrganization: Pick<
    Organization,
    "id" | "barcodesEnabled" | "currency"
  >;
  assetIndexCurrentSearchParams: string | null;
}) {
  // Make an array of the ids and check if we have to take all
  const ids = assetIds.split(",");
  const takeAll = ids.includes(ALL_SELECTED_KEY);

  /**
   * When taking all with filters (select all button), use the current page's search params
   * Otherwise, use cookie-based filters from the request
   */
  const filtersToUse =
    takeAll && assetIndexCurrentSearchParams
      ? assetIndexCurrentSearchParams
      : (
          await getAdvancedFiltersFromRequest(
            request,
            currentOrganization.id,
            settings
          )
        ).filters;

  const { assets } = await getAdvancedPaginatedAndFilterableAssets({
    request,
    organizationId: currentOrganization.id,
    filters: filtersToUse,
    settings,
    takeAll,
    assetIds: takeAll ? undefined : ids,
    canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
  });

  // ... build and return CSV
}
```

**Alternative Pattern (for simpler cases):**

When not using advanced filters, directly use `getAssetsWhereInput`:

```typescript
import { getAssetsWhereInput } from "~/modules/asset/utils.server";

// In your service function
const assetIds = searchParams.getAll("assetIds");

// Build where clause based on ALL_SELECTED_KEY
const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
  ? getAssetsWhereInput({
      organizationId,
      currentSearchParams: searchParams.toString(),
    })
  : { id: { in: assetIds }, organizationId };

const assets = await db.asset.findMany({ where });
```

## Helper Function: getAssetsWhereInput

Located in `app/modules/asset/utils.server.ts`, this function builds a Prisma where clause from URL search parameters:

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

Reference these working examples in the codebase:

### 1. Export Assets (Advanced Mode)

- **Button:** `app/components/assets/assets-index/export-assets-button.tsx`
- **Route:** `app/routes/_layout+/assets.export.$fileName[.csv].tsx`
- **Service:** `app/utils/csv.server.ts` → `exportAssetsFromIndexToCsv`

### 2. Bulk Delete Assets

- **Action:** `app/routes/_layout+/assets._index.tsx` (action function)
- **Service:** `app/modules/asset/service.server.ts` → `bulkDeleteAssets`

### 3. Bulk QR Code Download

- **API:** `app/routes/api+/assets.get-assets-for-bulk-qr-download.ts`
- Uses `getAssetsWhereInput` directly

### 4. Export Bookings

- **Button:** `app/components/booking/export-bookings-button.tsx`
- **Service:** `app/utils/csv.server.ts` → `exportBookingsFromIndexToCsv`

### 5. Export Team Members (NRMs)

- **Button:** `app/components/nrm/export-nrm-button.tsx`
- **Service:** `app/utils/csv.server.ts` → `exportNRMsToCsv`

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
const currentSearchParams = searchParams.get("currentSearchParams");
// Pass to service layer
```

**3. Service:**

```typescript
const takeAll = ids.includes(ALL_SELECTED_KEY);
const where = takeAll
  ? getAssetsWhereInput({ organizationId, currentSearchParams })
  : { id: { in: ids }, organizationId };
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
