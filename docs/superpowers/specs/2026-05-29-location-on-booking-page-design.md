# Location on the Booking Page — Design

**Date:** 2026-05-29
**Branch:** `feat-show-location-on-booking-page`
**Status:** Approved, ready for implementation plan

## Problem

Clients handling a booking need to know **where to pick up assets from**. The
booking overview asset/kit list does not surface location, cannot be sorted by
location, and its search only matches asset title + codes ("Search by asset
name"). We want location context on the list, location sorting, and a richer
multi-field search.

## Goals

1. Show a **Location** column on the booking overview asset rows and kit rows.
2. Allow **sorting** the booking asset list by location (alphabetical by
   location name).
3. Broaden **search** to match title, SAM-id (`sequentialId`), QR, category,
   tags, and location — logical OR, scoped to the current booking, including
   kit-level fields.

## Non-Goals

- No schema migration. `Asset.location` and `Kit.location` already exist.
- `Kit.sequentialId` / kit tags do not exist — SAM-id and tags search remain
  **asset-only** by design (matches the known v1.1 kit-parity gap).
- Mobile companion app is out of scope.

## Key architectural context

The booking overview list is **not** a standard Shelf list. It is a
two-pass, custom-paginated structure:

1. **Skeleton pass** — `getBooking()` in
   `apps/webapp/app/modules/booking/service.server.ts` fetches a lightweight
   asset set via `BOOKING_WITH_ASSETS_INCLUDE.assets.select`
   (`modules/booking/constants.ts`), applying search (`assetsWhere`) and a
   Prisma `orderBy` (`getBookingAssetsOrderBy`).
2. **In-memory grouping** — `groupAndSortAssetsByKit()`
   (`modules/booking/helpers.ts`) regroups assets into **kit-rows +
   standalone-asset-rows** and re-sorts. This is the _authoritative_ sort; the
   Prisma `orderBy` is effectively a tiebreaker.
3. **Detail pass** — `bookings.$bookingId.overview.tsx` loader runs a second
   `db.asset.findMany()` for the paginated slice with full relations. **This is
   what renders.** A separate `kits` query in the same `Promise.all` hydrates
   kit rows.

Implication: location must be added at multiple layers — skeleton select (for
sort + kit-field search), detail-pass include and kits query (for rendering),
and the sort helpers.

## Design decisions (confirmed)

- **Kit row location:** use the dedicated `Kit.location` field for both display
  and sort key. Expanded child assets still show their own `Asset.location`.
- **Search matches kit-level fields:** `kit.name`, `kit.location.name`,
  `kit.category.name` join the OR so a kit surfaces when its own fields match,
  not only when a child asset matches.
- **Partial kit matches → show the whole kit:** if any child asset matches by
  an asset-level field, the kit row shows all its assets (no
  "kit lost 3 assets" effect).

## Implementation by layer

### Layer 1 — Location column

- Add `location: { select: { id: true, name: true } }` to:
  - the skeleton select in `BOOKING_WITH_ASSETS_INCLUDE.assets.select`
    (`modules/booking/constants.ts`),
  - the detail-pass `db.asset.findMany` include in the overview loader,
  - the separate `kits` query in the same loader (so kit rows have it).
- Extend the skeleton's `kit` select to include
  `{ location: { select: { id, name } }, category: { select: { name } } }`
  (needed for kit-group sort + kit-field search).
- Render a **Location** column after Tags in:
  - `apps/webapp/app/components/booking/list-asset-content.tsx` (asset rows →
    `asset.location?.name`),
  - `apps/webapp/app/components/booking/kit-row.tsx` (kit rows →
    `kit.location?.name`).
  - Empty value renders a muted em-dash. Add the matching `<Th>` header.

### Layer 2 — Sort by location

- `getBookingAssetsOrderBy()` (`helpers.ts`): add
  `location: [{ location: { name: orderDirection } }]`.
- `groupAndSortAssetsByKit()` (`helpers.ts`): add a `case "location"` for both
  the standalone-asset comparator (`asset.location?.name`) and the kit-group
  comparator (`Kit.location.name`), cloning the existing `category` logic
  (null-to-end regardless of direction, title tiebreaker). Extend the
  `AssetWithKit` type with optional `location: { name: string } | null` and
  `kit` with optional `location`.
- Add `location: "Location"` to the booking sort-options constant powering the
  sort dropdown (in `modules/booking/constants.ts`).

### Layer 3 — Search

- Broaden `assetsWhere.OR` in `getBooking()` to match, per term:
  - asset-level: `title`, `sequentialId`, `qrCodes.some.id`,
    `barcodes.some.value`, `category.name`, `tags.some.name`, `location.name`;
  - kit-level: `kit.name`, `kit.location.name`, `kit.category.name`.
- Adopt comma-separated multi-term OR (each term OR-ed across all fields),
  matching the assets-index pattern in `modules/asset/service.server.ts`.
- **Whole-kit re-expansion:** collect the distinct `kitId`s of matched assets
  from the filtered set, then add `{ kitId: { in: matchedKitIds } }` to the
  final OR so sibling assets of a partially-matched kit come along. (Kit-field
  matches already return all of a kit's assets, so this only affects
  asset-level matches.)
- Booking overview loader: add a `searchFieldTooltip` (title + markdown list of
  searchable fields, noting SAM-id/tags are asset-only) rendered by the shared
  `SearchFieldTooltip`, and broaden `searchFieldLabel` from
  "Search by asset name".

### Layer 4 — Tests

- Extend `apps/webapp/app/modules/booking/helpers.test.ts`:
  - `getBookingAssetsOrderBy("location", ...)` returns the location orderBy.
  - `groupAndSortAssetsByKit` with `"location"`: standalone asset ordering,
    null locations to the end, kit-group ordering by `Kit.location`, title
    tiebreaker.

## Risks / edge cases

- **Two render layers must agree.** Location on the skeleton drives sort; on the
  detail pass drives display. Missing either yields "sorts but shows blank" or
  vice versa. The plan adds both explicitly.
- **PDF helper** (`modules/booking/pdf-helpers.ts`) also calls
  `groupAndSortAssetsByKit`. The new `location` case is additive and the type
  field is optional, so the PDF path is unaffected (it never passes
  `orderBy: "location"`).
- **Performance:** asset set is bounded to one booking, so the broadened OR and
  the extra `kitId` lookup are cheap. No new index needed.
