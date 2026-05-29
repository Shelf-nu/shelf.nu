# Location on the Booking Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface asset/kit location on the booking overview list — a Location column, location sorting, and a broadened multi-field search scoped to the booking.

**Architecture:** The booking overview list is a two-pass structure: `getBooking()` builds a lightweight, search-filtered, Prisma-ordered asset "skeleton"; `groupAndSortAssetsByKit()` regroups it into kit-rows + asset-rows with the authoritative in-memory sort; the route loader then hydrates the paginated slice with a detail-pass `findMany` (the rendered data) plus a separate `kits` query. Location is added at each of these layers. Search gains a comma-OR multi-field clause plus a whole-kit re-expansion step.

**Tech Stack:** Remix (react-router) + Prisma + Vitest. Webapp at `apps/webapp/`. Tests run with `pnpm webapp:test -- --run`.

**Decisions (from spec):** kit rows use the dedicated `Kit.location` field; search matches kit-level fields; an asset-level match inside a kit surfaces the whole kit. SAM-id/tags search is asset-only (kits have neither field).

> Reference spec: `docs/superpowers/specs/2026-05-29-location-on-booking-page-design.md`

---

## File map

- **Modify** `apps/webapp/app/modules/booking/helpers.ts` — add location to `getBookingAssetsOrderBy`, `groupAndSortAssetsByKit`, the `AssetWithKit` type; add new pure `buildBookingAssetsSearchOR`.
- **Modify** `apps/webapp/app/modules/booking/helpers.test.ts` — tests for the above.
- **Modify** `apps/webapp/app/modules/booking/constants.ts` — location in `BOOKING_WITH_ASSETS_INCLUDE` (asset + kit), add `location` to `BOOKING_ASSET_SORTING_OPTIONS`.
- **Modify** `apps/webapp/app/modules/booking/service.server.ts` — use `buildBookingAssetsSearchOR` + whole-kit re-expansion in `getBooking`.
- **Modify** `apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.tsx` — location include on detail-pass `findMany` + `kits` query; `searchFieldTooltip` + broadened `searchFieldLabel`.
- **Modify** `apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx` — add `location` to the exported `AssetWithBooking` type.
- **Modify** `apps/webapp/app/components/booking/booking-assets-column.tsx` — `<Th>Location</Th>` header.
- **Modify** `apps/webapp/app/components/booking/list-asset-content.tsx` — Location `<Td>` (asset rows).
- **Modify** `apps/webapp/app/components/booking/kit-row.tsx` — Location `<Td>` (kit rows) + `kit.location` prop + separator `colSpan`.

---

## Task 1: Location sort + search-clause builder in helpers (TDD)

**Files:**

- Modify: `apps/webapp/app/modules/booking/helpers.ts`
- Test: `apps/webapp/app/modules/booking/helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

In `helpers.test.ts`, update the import line and extend the `createAsset` helper, then add the new test blocks.

Change the import at the top:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildBookingAssetsSearchOR,
  getBookingAssetsOrderBy,
  groupAndSortAssetsByKit,
} from "./helpers";
```

Replace the existing `createAsset` helper (currently 6 params) with this extended version (two new optional trailing params — existing calls keep working):

```typescript
// Helper to create test assets
const createAsset = (
  id: string,
  title: string,
  status: string,
  kitId: string | null = null,
  kitName: string | null = null,
  categoryName: string | null = null,
  locationName: string | null = null,
  kitLocationName: string | null = null
) => ({
  id,
  title,
  status,
  kitId,
  kit: kitName
    ? {
        name: kitName,
        location: kitLocationName ? { name: kitLocationName } : null,
      }
    : null,
  category: categoryName ? { name: categoryName } : null,
  location: locationName ? { name: locationName } : null,
});
```

Add a new `it` inside the existing `describe("getBookingAssetsOrderBy", ...)` block:

```typescript
it("returns location ordering when orderBy is 'location'", () => {
  const result = getBookingAssetsOrderBy("location", "asc");
  expect(result).toEqual([{ location: { name: "asc" } }]);
});
```

Add a new `describe` block at the end of the file (before the final closing of the file), as a sibling of the other top-level describes:

```typescript
describe("groupAndSortAssetsByKit — location", () => {
  const createAsset = (
    id: string,
    title: string,
    status: string,
    kitId: string | null = null,
    kitName: string | null = null,
    categoryName: string | null = null,
    locationName: string | null = null,
    kitLocationName: string | null = null
  ) => ({
    id,
    title,
    status,
    kitId,
    kit: kitName
      ? {
          name: kitName,
          location: kitLocationName ? { name: kitLocationName } : null,
        }
      : null,
    category: categoryName ? { name: categoryName } : null,
    location: locationName ? { name: locationName } : null,
  });

  it("sorts individual assets by location name ascending", () => {
    const assets = [
      createAsset("1", "A", "AVAILABLE", null, null, null, "Warehouse B"),
      createAsset("2", "B", "AVAILABLE", null, null, null, "Warehouse A"),
    ];

    const result = groupAndSortAssetsByKit(assets, "location", "asc");

    expect(result[0].location?.name).toBe("Warehouse A");
    expect(result[1].location?.name).toBe("Warehouse B");
  });

  it("places assets with no location at the end regardless of direction", () => {
    const assets = [
      createAsset("1", "NoLoc", "AVAILABLE"),
      createAsset("2", "HasLoc", "AVAILABLE", null, null, null, "Shelf 1"),
    ];

    const ascResult = groupAndSortAssetsByKit(assets, "location", "asc");
    expect(ascResult[0].location?.name).toBe("Shelf 1");
    expect(ascResult[1].location).toBeNull();

    const descResult = groupAndSortAssetsByKit(assets, "location", "desc");
    expect(descResult[1].location).toBeNull();
  });

  it("sorts kit groups by the kit's own location", () => {
    const assets = [
      createAsset(
        "1",
        "A",
        "AVAILABLE",
        "kit-z",
        "Kit Z",
        null,
        null,
        "Zone Z"
      ),
      createAsset(
        "2",
        "B",
        "AVAILABLE",
        "kit-a",
        "Kit A",
        null,
        null,
        "Zone A"
      ),
    ];

    const result = groupAndSortAssetsByKit(assets, "location", "asc");

    expect(result[0].kit?.name).toBe("Kit A");
    expect(result[1].kit?.name).toBe("Kit Z");
  });
});

describe("buildBookingAssetsSearchOR", () => {
  it("produces one OR group per comma-separated term", () => {
    const result = buildBookingAssetsSearchOR("laptop, dock");
    expect(result).toHaveLength(2);
  });

  it("matches asset title, location, and kit location for a term", () => {
    const [group] = buildBookingAssetsSearchOR("warehouse");
    const json = JSON.stringify(group);
    expect(json).toContain('"title"');
    expect(json).toContain('"location"');
    expect(json).toContain('"sequentialId"');
    expect(json).toContain('"kit"');
    // term is lower-cased and trimmed
    expect(json).toContain("warehouse");
  });

  it("returns an empty array for blank search", () => {
    expect(buildBookingAssetsSearchOR("   ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm webapp:test -- --run app/modules/booking/helpers.test.ts`
Expected: FAIL — `buildBookingAssetsSearchOR` is not exported; `location` ordering assertion fails.

- [ ] **Step 3: Implement in `helpers.ts`**

Extend the `AssetWithKit` type (add optional `location` and optional `kit.location`):

```typescript
type AssetWithKit = {
  id: string;
  title: string;
  status: string;
  kitId: string | null;
  kit: { name: string; location?: { name: string } | null } | null;
  category: { name: string } | null;
  location?: { name: string } | null;
  [key: string]: unknown;
};
```

Add `location` to the `getBookingAssetsOrderBy` map and update its JSDoc `@param` to mention `location`:

```typescript
const orderByMap: Record<string, Prisma.AssetOrderByWithRelationInput[]> = {
  status: [{ status: orderDirection }, { createdAt: "asc" }],
  title: [{ title: orderDirection }],
  category: [{ category: { name: orderDirection } }],
  location: [{ location: { name: orderDirection } }],
};
```

In `groupAndSortAssetsByKit`, change the `kitGroups` map to also carry the kit's location name. Replace the map declaration and population loop:

```typescript
// Group kit assets by kitId
const kitGroups = new Map<
  string,
  { kitName: string; kitLocationName: string | null; assets: T[] }
>();
for (const asset of kitAssets) {
  const kitId = asset.kitId!;
  if (!kitGroups.has(kitId)) {
    kitGroups.set(kitId, {
      kitName: asset.kit!.name,
      kitLocationName: asset.kit!.location?.name ?? null,
      assets: [],
    });
  }
  kitGroups.get(kitId)!.assets.push(asset);
}
```

In the `compareAssets` switch, add a `case "location"` immediately before `case "status"` (mirrors the `category` null-to-end logic):

```typescript
      case "location": {
        const locA = a.location?.name;
        const locB = b.location?.name;
        // Null locations go to the end regardless of direction
        if (!locA && locB) return 1;
        if (locA && !locB) return -1;
        if (!locA && !locB) return a.title.localeCompare(b.title);
        return multiplier * locA!.localeCompare(locB!);
      }
```

In the kit-group `sortedKitGroups` switch, add a `case "location"` immediately before `case "status"` (sorts kit groups by `Kit.location`):

```typescript
        case "location": {
          const locA = groupA.kitLocationName;
          const locB = groupB.kitLocationName;
          // Null locations go to the end regardless of direction
          if (!locA && locB) return 1;
          if (locA && !locB) return -1;
          if (!locA && !locB)
            return groupA.kitName.localeCompare(groupB.kitName);
          return multiplier * locA!.localeCompare(locB!);
        }
```

Add the new pure search-clause builder at the end of the file:

```typescript
/**
 * Builds the per-term OR clauses for searching a booking's assets across
 * multiple fields. Each comma-separated term becomes one OR group; a row
 * matches the term if any field matches (case-insensitive substring).
 *
 * Asset-level fields: title, sequentialId (SAM-id), category, tags, location,
 * QR id, barcode value. Kit-level fields (name, location, category) are
 * included so a kit surfaces when its own attributes match — kits have no
 * sequentialId or tags, so those remain asset-only.
 *
 * Returned as an array intended to be spread into a `where.OR`. Returns an
 * empty array for blank input.
 *
 * @param search - Raw search string from the `s` query param
 * @returns Array of `{ OR: [...] }` clauses, one per term
 */
export function buildBookingAssetsSearchOR(
  search: string
): Prisma.AssetWhereInput[] {
  const terms = search
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  return terms.map((term) => ({
    OR: [
      // Asset-level fields
      { title: { contains: term, mode: "insensitive" } },
      { sequentialId: { contains: term, mode: "insensitive" } },
      { category: { name: { contains: term, mode: "insensitive" } } },
      { tags: { some: { name: { contains: term, mode: "insensitive" } } } },
      { location: { name: { contains: term, mode: "insensitive" } } },
      { qrCodes: { some: { id: { contains: term, mode: "insensitive" } } } },
      {
        barcodes: { some: { value: { contains: term, mode: "insensitive" } } },
      },
      // Kit-level fields (kits have no sequentialId / tags)
      { kit: { name: { contains: term, mode: "insensitive" } } },
      { kit: { location: { name: { contains: term, mode: "insensitive" } } } },
      { kit: { category: { name: { contains: term, mode: "insensitive" } } } },
    ],
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm webapp:test -- --run app/modules/booking/helpers.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Kill vitest workers**

Run: `pkill -f vitest || true`

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/app/modules/booking/helpers.ts apps/webapp/app/modules/booking/helpers.test.ts
git commit -m "feat(booking): add location sort + multi-field search clause helpers"
```

---

## Task 2: Add `location` to the sort dropdown options

**Files:**

- Modify: `apps/webapp/app/modules/booking/constants.ts:143-147`

The `BookingAssetsFilters` `SortBy` dropdown reads `BOOKING_ASSET_SORTING_OPTIONS` directly, so adding the entry wires the UI automatically.

- [ ] **Step 1: Add the option**

Replace the constant:

```typescript
export const BOOKING_ASSET_SORTING_OPTIONS = {
  status: "Status",
  title: "Name",
  category: "Category",
  location: "Location",
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/webapp/app/modules/booking/constants.ts
git commit -m "feat(booking): expose location as a booking asset sort option"
```

---

## Task 3: Plumb location into the skeleton select

**Files:**

- Modify: `apps/webapp/app/modules/booking/constants.ts:80-114`

This select drives sorting (`groupAndSortAssetsByKit` reads `asset.location` and `asset.kit.location`) and kit-level search. Keep it tight (`id` + `name`).

- [ ] **Step 1: Add location to the asset select and expand the kit select**

In `BOOKING_WITH_ASSETS_INCLUDE.assets.select`, after the `category` block and replacing the `kit` block, set:

```typescript
      category: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
      // Asset's own location — drives the Location column sort and search.
      location: {
        select: {
          id: true,
          name: true,
        },
      },
      kit: {
        select: {
          name: true,
          // Kit's own location + category — needed for kit-group location
          // sorting and kit-level search. Kits have no sequentialId/tags.
          location: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              name: true,
            },
          },
        },
      },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm turbo typecheck --filter @shelf/webapp`
Expected: PASS (the inferred `BookingAsset` type now includes `location` and `kit.location`).

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/app/modules/booking/constants.ts
git commit -m "feat(booking): include asset + kit location in booking assets skeleton select"
```

---

## Task 4: Broaden search + whole-kit re-expansion in `getBooking`

**Files:**

- Modify: `apps/webapp/app/modules/booking/service.server.ts:3873-3890`

- [ ] **Step 1: Add the import**

Ensure `getBooking`'s module imports the helpers. Find the existing import of `getBookingAssetsOrderBy` from `./helpers` (it is imported in this file already) and add `buildBookingAssetsSearchOR` to that import list. For example:

```typescript
import { getBookingAssetsOrderBy, buildBookingAssetsSearchOR } from "./helpers";
```

(If `getBookingAssetsOrderBy` is imported on a single line, just add `buildBookingAssetsSearchOR` to the same braces. Do not create a second import from the same path.)

- [ ] **Step 2: Replace the search block**

Replace the current `if (search) { assetsWhere.OR = [...]; }` block (the three-clause title/qr/barcode version) with:

```typescript
if (search) {
  // Multi-field, comma-OR search across the booking's assets + kits.
  const searchOR = buildBookingAssetsSearchOR(search);

  // Whole-kit re-expansion: an asset-level match inside a kit should
  // surface the ENTIRE kit, not just the matched asset. Find which kits
  // contain a match, then pull their sibling assets in too. Scoped by
  // booking membership only (not organizationId) so cross-org booking
  // views keep working — the main findFirstOrThrow below authorizes
  // access to the booking itself.
  const matchedAssets = await db.asset.findMany({
    where: {
      bookings: { some: { id } },
      OR: searchOR,
    },
    select: { id: true, kitId: true },
  });
  const matchedKitIds = [
    ...new Set(
      matchedAssets
        .map((asset) => asset.kitId)
        .filter((kitId): kitId is string => Boolean(kitId))
    ),
  ];

  assetsWhere.OR = [
    ...searchOR,
    ...(matchedKitIds.length ? [{ kitId: { in: matchedKitIds } }] : []),
  ];
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo typecheck --filter @shelf/webapp`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/app/modules/booking/service.server.ts
git commit -m "feat(booking): broaden booking asset search to multiple fields + kits"
```

---

## Task 5: Location on the detail-pass + kits query, and the search tooltip

**Files:**

- Modify: `apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.tsx`

- [ ] **Step 1: Import the shared location include**

Add this import alongside the other module imports near the top of the file:

```typescript
import { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
```

- [ ] **Step 2: Add location to the detail-pass `findMany` include**

In the `db.asset.findMany` call (the `assetDetails` query, currently around line 349-410), add a `location` entry to its `include` block (e.g. right after `kit: true,`):

```typescript
        include: {
          category: true,
          custody: true,
          tags: TAG_WITH_COLOR_SELECT,
          kit: true,
          // Asset's pickup location — rendered in the booking Location column.
          location: LOCATION_WITH_HIERARCHY,
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          bookings: {
            // ...unchanged...
          },
        },
```

- [ ] **Step 3: Add location to the `kits` query include**

In the `db.kit.findMany` call (currently around line 422-446), add `location` to its `include` block (e.g. after the `barcodes` line):

```typescript
        include: {
          category: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          qrCodes: { take: 1, select: { id: true } },
          barcodes: { select: { id: true, type: true, value: true } },
          // Kit's pickup location — rendered on the kit row.
          location: LOCATION_WITH_HIERARCHY,
          _count: { select: { assets: true } },
        },
```

- [ ] **Step 4: Add the search tooltip + broaden the label**

In the loader's returned `payload({ ... })`, replace the `searchFieldLabel` line (currently `searchFieldLabel: "Search by asset name",`) with:

```typescript
        // Asset search label + tooltip listing searchable fields
        searchFieldLabel: "Search assets & kits",
        searchFieldTooltip: {
          title: "Search booking items",
          text: "Search the assets and kits in this booking. Separate keywords with a comma (,) to search with OR. Supported fields:\n- Name\n- Asset ID (SAM-id, assets only)\n- Category\n- Tags (assets only)\n- Location\n- QR code value\n- Barcode value",
        },
```

- [ ] **Step 5: Typecheck**

Run: `pnpm turbo typecheck --filter @shelf/webapp`
Expected: PASS. (`SearchFieldTooltip` already reads `searchFieldTooltip` from loader data; no component change needed.)

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.tsx
git commit -m "feat(booking): hydrate asset/kit location + add search tooltip on booking page"
```

---

## Task 6: Render the Location column

**Files:**

- Modify: `apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx:102-114` (type)
- Modify: `apps/webapp/app/components/booking/booking-assets-column.tsx:194` (header)
- Modify: `apps/webapp/app/components/booking/list-asset-content.tsx:222` (asset row)
- Modify: `apps/webapp/app/components/booking/kit-row.tsx` (kit row + props + colSpan)

- [ ] **Step 1: Add `location` to the `AssetWithBooking` type**

In `bookings.$bookingId.overview.manage-assets.tsx`, extend the exported type (the file already imports `Prisma` and `LOCATION_WITH_HIERARCHY`):

```typescript
export type AssetWithBooking = Asset & {
  bookings: Booking[];
  custody: Custody | null;
  category: Category;
  tags: Pick<Tag, "id" | "name" | "color">[];
  kitId?: string | null;
  qrScanned: string;
  // Pickup location rendered in the booking Location column.
  location?: Prisma.LocationGetPayload<typeof LOCATION_WITH_HIERARCHY> | null;
  // Fields required by `resolveDisplayCode` for the asset-code badge.
  qrCodes: { id: string }[];
  barcodes: { id: string; type: BarcodeType; value: string }[];
};
```

- [ ] **Step 2: Add the header column**

In `booking-assets-column.tsx`, in the `<ListHeader hideFirstColumn>` block, add a Location header immediately after `<Th>Tags</Th>` (line 194):

```tsx
                    <Th>Category</Th>
                    <Th>Tags</Th>
                    <Th>Location</Th>
```

- [ ] **Step 3: Render location on asset rows**

In `list-asset-content.tsx`, add the import at the top with the other component imports:

```typescript
import { LocationBadge } from "~/components/location/location-badge";
```

Then add a Location `<Td>` immediately after the Tags `<Td>` (the one wrapping `<ListItemTagsColumn tags={tags} />`, ending at line 222), before the `{shouldShowCheckinColumns && (` block:

```tsx
<Td
  className={tw(
    isKitAsset ? "bg-gray-50/50" : "" // Light background for kit assets
  )}
>
  {item.location ? (
    <LocationBadge
      location={{
        id: item.location.id,
        name: item.location.name,
        parentId: item.location.parentId ?? undefined,
        childCount: item.location._count?.children ?? 0,
      }}
    />
  ) : (
    <EmptyTableValue />
  )}
</Td>
```

Note: `EmptyTableValue` is already imported in this file (used by the check-in columns). If a lint error says it is not, add `import { EmptyTableValue } from "../shared/empty-table-value";`.

- [ ] **Step 4: Render location on kit rows + extend props + fix colSpan**

In `kit-row.tsx`:

(a) Add imports at the top with the other component imports:

```typescript
import { LocationBadge } from "~/components/location/location-badge";
```

(b) Extend the `kit` prop shape in `KitRowProps` (add the `location` field):

```typescript
  kit: Pick<Kit, "id" | "name" | "image" | "status"> & {
    imageExpiration: string | Date | null;
    category: Pick<Category, "name" | "id" | "color"> | null;
    // Kit's pickup location — rendered in the Location column.
    location?: {
      id: string;
      name: string;
      parentId: string | null;
      _count?: { children: number };
    } | null;
    qrCodes?: { id: string }[];
    barcodes?: Pick<Barcode, "id" | "type" | "value">[];
  };
```

(c) Add a Location `<Td>` immediately after the Tags placeholder `<Td>` (the one wrapping `<EmptyTableValue />` at lines 152-154), before the `{shouldShowCheckinColumns && (` block:

```tsx
<Td>
  {kit.location ? (
    <LocationBadge
      location={{
        id: kit.location.id,
        name: kit.location.name,
        parentId: kit.location.parentId ?? undefined,
        childCount: kit.location._count?.children ?? 0,
      }}
    />
  ) : (
    <EmptyTableValue />
  )}
</Td>
```

(d) Update the kit-separator `colSpan` (currently `shouldShowCheckinColumns ? 8 : 6`) to account for the new column:

```tsx
<tr className="kit-separator h-1 bg-gray-100">
  <td colSpan={shouldShowCheckinColumns ? 9 : 7} className="h-1 p-0"></td>
</tr>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm turbo typecheck --filter @shelf/webapp`
Expected: PASS. (The loader's kit objects come from `LOCATION_WITH_HIERARCHY`, which provides `id`, `name`, `parentId`, `_count.children` — matching both prop shapes.)

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/app/routes/_layout+/bookings.$bookingId.overview.manage-assets.tsx apps/webapp/app/components/booking/booking-assets-column.tsx apps/webapp/app/components/booking/list-asset-content.tsx apps/webapp/app/components/booking/kit-row.tsx
git commit -m "feat(booking): render Location column on booking asset and kit rows"
```

---

## Task 7: Full validation

**Files:** none (verification only)

- [ ] **Step 1: Run the full validation pipeline**

Run: `pnpm webapp:validate`
Expected: PASS — prisma generate, eslint, prettier, typecheck, unit tests all green.

- [ ] **Step 2: Kill vitest workers**

Run: `pkill -f vitest || true`

- [ ] **Step 3: Manual smoke (optional, requires running app)**

If running the app locally (`pnpm webapp:dev`): open a booking with both standalone assets and a kit, where assets/kits have locations. Verify: (1) Location column shows per row; kit rows show the kit's location. (2) Sort dropdown has "Location" and reorders rows alphabetically with blanks last. (3) Searching a location name returns matching assets and the whole kit when a kit (or one of its assets) matches; the tooltip lists the searchable fields.

---

## Self-review notes

- **Spec coverage:** Column (Tasks 3,5,6) · Sort (Tasks 1,2,3) · Search incl. kit fields + whole-kit re-expansion + tooltip (Tasks 4,5,1). All spec sections mapped.
- **Two-layer location:** skeleton select (Task 3) for sort/search; detail-pass + kits query (Task 5) for rendering — both present, avoiding "sorts but blank" / "shows but won't sort".
- **PDF helper** (`pdf-helpers.ts`) calls `groupAndSortAssetsByKit` but never with `orderBy: "location"` and the new type fields are optional, so it is unaffected — no change needed.
- **Type consistency:** `buildBookingAssetsSearchOR` name identical across Task 1 (def/test) and Task 4 (use). `LocationBadge` `childCount`/`parentId` mapping identical in Tasks 6c and the existing manage-assets RowComponent. `colSpan` 9/7 matches the new column count (was 8/6).
