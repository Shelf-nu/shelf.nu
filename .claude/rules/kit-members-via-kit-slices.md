---
description: Route kit members into a booking through kitSlices, never the standalone assetIds bucket
globs: apps/webapp/app/routes/_layout+/*booking*,apps/webapp/app/routes/_layout+/kits.*,apps/webapp/app/modules/booking/service.server.ts
---

# Kit Members Go Through `kitSlices`, Not `assetIds`

Post-pivot, `BookingAsset.assetKitId` discriminates a slice: `NULL` =
standalone (free pool), non-null = kit-driven (FK → `AssetKit.id`). The two
**partial** unique indexes let one standalone row coexist with N kit rows for
the same `(booking, asset)` — by design for QT free-pool + kit bookings.

`createBooking` / `updateBookingAssets` create a standalone row for **every**
`assetIds` entry and a kit row for **every** `kitSlices` entry — they do NOT
cross-check the buckets. So when adding a kit, routing its member asset ids
through `assetIds` is always wrong, in one of two ways:

- Pass members in **both** `assetIds` AND `kitSlices` → **duplicate** rows
  (member shows twice; inflates every count/progress/value total). This was the
  v1 `manage-kits` bug — pre-pivot the old single unique masked it.
- Pass members in `assetIds` **only** (no `kitSlices`) → **kit grouping lost**
  (members render as loose rows, kit unrecognized).

**Rule:** resolve memberships with `buildKitSlicesForBooking({ kitIds,
organizationId, existingAssetKitIds })` and pass `assetIds: []` (kit-only add)
or `assetIds: <genuinely-standalone-only>` (mixed). Reference-correct flows:
`manage-kits` and `scan-assets` (which subtracts kit-slice asset ids from the
standalone bucket: `assetIds.filter(id => !kitSliceAssetIds.has(id))`).

```ts
// ❌ Bad — members in the standalone bucket (duplicates, or lost grouping)
await updateBookingAssets({
  id,
  organizationId,
  assetIds: kitMemberIds,
  kitSlices,
});

// ✅ Good — members only as kit-driven slices
const kitSlices = await buildKitSlicesForBooking({
  kitIds,
  organizationId,
  existingAssetKitIds,
});
await updateBookingAssets({
  id,
  organizationId,
  assetIds: [],
  kitSlices,
  kitIds,
  userId,
});
```

When you touch one kit→booking flow, grep the siblings (`manage-kits`,
`kits.$kitId.assets.add-to-existing-booking`, `kits.$kitId.assets.create-new-booking`
→ `createBooking`, `scan-assets`) — this bug travels in packs. See
[[quantity-semantics-per-surface]].
