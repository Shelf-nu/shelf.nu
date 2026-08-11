/**
 * Asset Quantity Overview — display mapper
 *
 * Maps the shared `getAssetAvailability` primitive
 * (`~/modules/asset/availability.server`) into the `QuantityData` shape the
 * asset overview sidebar's `<QuantityOverviewCard>` renders.
 *
 * Extracted into its own module (rather than living inline in the asset
 * overview loader) purely for unit-testability: the loader
 * (`routes/_layout+/assets.$assetId.overview.tsx`) has over a dozen
 * unrelated collaborators (auth, custom fields, reminders, QR/scan lookups)
 * that would need mocking just to reach this ~10-line mapping if it stayed
 * inline. Isolating it lets the #2724 regression test ("Available" must
 * never go negative from all-time reservations) run fast and mock-free
 * beyond its one direct input.
 *
 * @see {@link file://./availability.server.ts} - The primitive this module maps from
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx} - The loader that calls this
 * @see {@link file://./../../components/assets/quantity-overview-card.tsx} - The component this feeds
 * @see superpowers/2026-07-27-qt-availability-unification-plan.md - Task 6/7
 */

import type { AssetAvailability } from "~/modules/asset/availability.server";

/**
 * The quantity breakdown surfaced on the asset overview sidebar's Quantity
 * Overview card, for QUANTITY_TRACKED assets only. Every numeric field maps
 * 1:1 onto a `<QuantityOverviewCard>` prop — see {@link buildQuantityData}.
 */
export type QuantityData = {
  /** `Asset.quantity` — total units owned. */
  total: number;
  /**
   * Operator-only custody — sum of `Custody.quantity` where
   * `kitCustodyId IS NULL`. Kit-allocated custody rows mirror
   * `AssetKit.quantity` and are already counted via `inKits`; including
   * them here would double-count.
   */
  inCustody: number;
  /**
   * Sum of `AssetKit.quantity` across every kit this asset participates
   * in. Surfaced on the sidebar so users can see how many units are
   * earmarked for kit use.
   */
  inKits: number;
  /**
   * Sum of `AssetLocation.quantity` across every location this asset is
   * placed at. Surfaced on the sidebar Quantity Overview so users see the
   * placed / unplaced split at a glance. Does NOT subtract from
   * `available` — placements are orthogonal to custody / bookings.
   */
  inLocations: number;
  /**
   * Window-agnostic sum of every active (non-kit-driven) reservation's
   * remaining quantity — `AssetAvailability.reservedTotal`. Surfaced on
   * the "Reserved (bookings)" row alongside an explanatory tooltip (these
   * units are committed to future dates but still physically on the
   * shelf, so they do NOT subtract from `available` below — see #2724).
   */
  reserved: number;
  /** Count of distinct bookings contributing to `reserved`, for the tooltip copy. */
  reservingBookingCount: number;
  /**
   * Units actively off the shelf via ONGOING/OVERDUE bookings
   * (`AssetAvailability.checkedOut`).
   */
  checkedOut: number;
  /**
   * Headline "Available" figure: **current physical stock**
   * (`AssetAvailability.physicalAvailable` = total − inCustody − inKits −
   * checkedOut). Deliberately window-agnostic and never reduced by future
   * reservations — that's the #2724 fix: the old formula also subtracted
   * every all-time reservation here, which could (and did) go negative.
   */
  available: number;
  /**
   * Cap used for custody assignment / total-quantity adjustments. Now
   * equal to `available` — both source from `physicalAvailable` — kept as
   * a distinct field only to avoid touching every existing card/dialog
   * call site that reads `custodyAvailable` specifically.
   */
  custodyAvailable: number;
};

/** Arguments for {@link buildQuantityData}. */
type BuildQuantityDataArgs = {
  /** Result of `getAssetAvailability({ assetId, organizationId })`, called with NO window (current-state mode). */
  availability: AssetAvailability;
  /** Sum of `AssetLocation.quantity` for this asset — not returned by the primitive, computed separately by the loader. */
  inLocations: number;
};

/**
 * Maps the shared {@link AssetAvailability} primitive's current-state
 * (unwindowed) result — plus the already-loaded location-placement total —
 * into the {@link QuantityData} shape the asset overview sidebar renders.
 *
 * @param args - See {@link BuildQuantityDataArgs}.
 * @returns The `QuantityData` shape consumed by `<QuantityOverviewCard>`.
 */
export function buildQuantityData({
  availability,
  inLocations,
}: BuildQuantityDataArgs): QuantityData {
  return {
    total: availability.total,
    inCustody: availability.inCustody,
    inKits: availability.inKits,
    inLocations,
    reserved: availability.reservedTotal,
    reservingBookingCount: availability.reservingBookingCount,
    checkedOut: availability.checkedOut,
    // Current-state headline — never dragged negative by all-time
    // reservations. See the #2724 fix note on `QuantityData.available`.
    available: availability.physicalAvailable,
    custodyAvailable: availability.physicalAvailable,
  };
}
