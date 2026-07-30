/**
 * Booking-overview QT availability builder.
 *
 * Houses `buildAvailableUnitsByAsset` as a standalone SERVER module, kept
 * separate from `routes/_layout+/bookings.$bookingId.overview.tsx` on
 * purpose: React Router only strips server-only code out of a route's
 * `loader`/`action`/`middleware`/`headers` exports for the client bundle. An
 * EXPORTED helper living directly in the route file — even one only called
 * from `loader` — still counts as a route export, so Vite's client build
 * tries to bundle it (and, transitively, the server-only
 * `~/modules/asset/availability.server` it imports), throwing "Server-only
 * module referenced by client". Since this route also has a `clientLoader`,
 * the route module genuinely does get bundled for the client, which is what
 * surfaced the leak. Moving the helper here — a plain `.server.ts` module
 * with no route exports — keeps it entirely out of the client graph; the
 * route only ever calls it from inside `loader`.
 *
 * @see file://../../routes/_layout+/bookings.$bookingId.overview.tsx
 * @see file://../asset/availability.server.ts
 */
import type { AssetType } from "@prisma/client";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";

/**
 * Per-asset QT availability figures surfaced to the booking-overview UI.
 *
 * - `bookable` — windowed figure (`total - inCustody - inKits - reserved`,
 *   clamped to 0). Drives the RED "Insufficient stock" badge
 *   (`InsufficientStockBadge`): a hard blocker when the row's booked
 *   quantity exceeds this. It is ALSO the real cap surfaced by the "Adjust
 *   booked quantity" dialog (`AdjustBookingAssetQuantityDialog`) — the
 *   workspace TOTAL (`Asset.quantity`) is the wrong ceiling there because it
 *   ignores what other overlapping bookings already hold.
 * - `physicalNow` — window-independent "physical-now" figure
 *   (`total - inCustody - inKits - checkedOut`, clamped to 0), i.e. units
 *   literally on the shelf right now. Drives the AMBER "pending return"
 *   badge (`PendingReturnBadge`) on not-yet-started bookings: the row's
 *   booked quantity fits within `bookable` (no genuine over-commit) but
 *   currently exceeds `physicalNow` because some units are checked out on
 *   OTHER bookings right now — they're expected back before this booking
 *   starts.
 * - `reserved` — windowed units held by OTHER bookings competing for this
 *   same pool (mirrors {@link AssetAvailability.reserved}, clamped to 0 for
 *   display). Surfaced so the "Adjust booked quantity" dialog can explain
 *   WHY `bookable` is below the workspace total ("Some units are also
 *   reserved by other bookings") instead of leaving the cap unexplained.
 */
export type QtyAssetAvailability = {
  bookable: number;
  physicalNow: number;
  reserved: number;
};

/**
 * Builds the QT workspace-availability map that drives the stock-warning
 * badges in `list-asset-content.tsx` and `booking-assets-sidebar.tsx` (see
 * `resolveQtyStockBadgeVariant` in `~/utils/booking-assets` for the shared
 * 3-state decision logic): RED "Insufficient stock" fires when a row's
 * `bookedQuantity` exceeds `availableUnitsByAsset[assetId].bookable`; AMBER
 * "pending return" fires when the booking hasn't started yet and the row's
 * `bookedQuantity` exceeds `availableUnitsByAsset[assetId].physicalNow`
 * (while still fitting within `bookable`).
 *
 * Delegates to the shared, windowed `getAssetAvailabilityBatch` primitive
 * (`~/modules/asset/availability.server`) in ONE batched call instead of the
 * two previous GLOBAL (all-time, un-windowed) `db.bookingAsset.groupBy`
 * reads. Those groupBys summed every RESERVED / ONGOING+OVERDUE row for the
 * asset across the ENTIRE workspace history with no date-overlap filter, so
 * a row backed only by a legitimately non-overlapping other booking still
 * inflated `reserved` and could false-fire the badge. They also had no
 * `assetKitId: null` filter, so kit-driven rows were double-counted on top
 * of custody. `getAssetAvailabilityBatch` fixes both: `reserved` is the
 * PEAK-CONCURRENT sum within the booking's own `[from, to]` window (or an
 * un-windowed total for a DRAFT booking with no dates yet), and kit-driven
 * rows are excluded from `reserved` (they're already reflected via
 * `inKits`).
 *
 * The current booking's OWN reservation is excluded (`excludeBookingId`) so
 * a row is measured against what ELSE is competing for the same pool, not
 * against its own booked quantity — matching the old groupBys' `id: { not:
 * bookingId }` filter.
 *
 * @param args.rawAssets - Enriched booking-asset rows for this booking (only
 *   `id` and `type` are read here).
 * @param args.qtyAssetIdsInBooking - QUANTITY_TRACKED asset ids on this
 *   booking (deduped).
 * @param args.organizationId - Caller's organization — scopes every
 *   underlying query so no cross-org reservation can leak into the map.
 * @param args.booking - The current booking; `.from`/`.to` (when both set)
 *   become the availability window, `.id` is excluded from the pool.
 * @returns `assetId -> { bookable, physicalNow, reserved }` (all clamped to
 *   0 for display) for every QUANTITY_TRACKED asset in `rawAssets`.
 */
export async function buildAvailableUnitsByAsset({
  rawAssets,
  qtyAssetIdsInBooking,
  organizationId,
  booking,
}: {
  rawAssets: Array<{ id: string; type: AssetType }>;
  qtyAssetIdsInBooking: string[];
  organizationId: string;
  booking: { id: string; from: Date | null; to: Date | null };
}): Promise<Record<string, QtyAssetAvailability>> {
  const availability = await getAssetAvailabilityBatch(qtyAssetIdsInBooking, {
    organizationId,
    window:
      booking.from && booking.to
        ? { from: booking.from, to: booking.to }
        : null,
    excludeBookingId: booking.id,
  });

  const availableUnitsByAsset: Record<string, QtyAssetAvailability> = {};
  for (const asset of rawAssets) {
    if (asset.type !== "QUANTITY_TRACKED") continue;
    const entry = availability.get(asset.id);
    availableUnitsByAsset[asset.id] = {
      bookable: Math.max(0, entry?.bookable ?? 0),
      physicalNow: Math.max(0, entry?.physicalAvailable ?? 0),
      reserved: Math.max(0, entry?.reserved ?? 0),
    };
  }
  return availableUnitsByAsset;
}
