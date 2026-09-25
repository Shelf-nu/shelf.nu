/**
 * Booking asset view-shaping (pure, client-safe).
 *
 * Encapsulates the filter → sort → group-by-kit → paginate → build-items
 * pipeline for the booking overview asset list, so the exact same logic runs
 * on the server (first paint) and in the browser (`clientLoader`) with no
 * drift. Operates on ALREADY-ENRICHED assets/kits, so the produced
 * `items[].assets` are render-ready. Must work on serialized data (Date fields
 * are strings after the network / hydration); it never constructs Dates itself.
 *
 * Also orders the mobile booking detail's assets, which arrive one row per
 * asset rather than one per slice, by the same checked-out rule
 * ({@link sortCollapsedBookingAssets}), so the phone and the web list a booking
 * in the same order.
 *
 * @see {@link file://./helpers.ts} filterBookingAssets / groupAndSortAssetsByKit
 * @see {@link file://../../utils/booking-assets.ts} resolveBookingRowQtyState
 * @see {@link file://../../routes/api+/mobile+/bookings.$bookingId.ts} the mobile booking detail
 * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
 */
import { AssetStatus } from "@prisma/client";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { BookingRowStatusInput } from "~/utils/booking-assets";
import { resolveBookingRowQtyState } from "~/utils/booking-assets";
import { filterBookingAssets, groupAndSortAssetsByKit } from "./helpers";

/**
 * Whether a booking row belongs in the Status sort's checked-out (bottom)
 * bucket.
 *
 * A row is checked out when its RESOLVED badge status is CHECKED_OUT, from the
 * same shared resolver the row badge uses, so the badge a user sees and the
 * bucket the row sorts into never disagree. The resolver reads the per-slice
 * counters first: a fully-checked-out kit slice sinks even though the
 * multi-slice asset's GLOBAL status has not flipped, while a QT row with a
 * partial return underway (or on a DRAFT/RESERVED booking) stays on top as its
 * actionable state.
 *
 * @param row - One booking row (one `BookingAsset` slice) with its per-slice
 *   quantity counters.
 * @param partialCheckinDetails - The booking's partial check-in records, keyed
 *   by asset id.
 * @param bookingStatus - The parent booking's status.
 * @returns `true` when the row sorts into the checked-out bucket.
 */
function isBookingRowCheckedOut(
  row: BookingRowStatusInput,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  return (
    resolveBookingRowQtyState(row, partialCheckinDetails, bookingStatus)
      .contextStatus === AssetStatus.CHECKED_OUT
  );
}

/** A rendered pagination row: a grouped kit (with its assets) or a lone asset. */
export type BookingPaginationItem<TAsset, TKit> = {
  type: "kit" | "asset";
  id: string;
  assets: TAsset[];
  kit?: TKit | null;
};

/** Inputs for {@link shapeBookingAssets}. */
export interface ShapeBookingAssetsParams<TAsset, TKit> {
  /** Fully-enriched, ALL booking assets (unfiltered, unsorted). */
  rawAssets: TAsset[];
  /** Fully-enriched, ALL booking kits. */
  rawKits: TKit[];
  /** Raw search string (`s` param); blank/null returns everything. */
  search: string | null | undefined;
  /** Sort field already normalized (createdAt → status done by caller). */
  orderBy: string;
  orderDirection: "asc" | "desc";
  /** 1-based page. */
  page: number;
  perPage: number;
  partialCheckinDetails: PartialCheckinDetailsType;
  /** Parent booking status — drives booking-context checked-out resolution. */
  bookingStatus: string;
}

/** Output of {@link shapeBookingAssets} — the view fields the route returns. */
export interface ShapeBookingAssetsResult<TAsset, TKit> {
  items: BookingPaginationItem<TAsset, TKit>[];
  totalPaginationItems: number;
  totalPages: number;
  totalKits: number;
  assetsCount: number;
}

/**
 * Filters, sorts, groups by kit, and paginates a booking's enriched assets.
 *
 * @returns The current page's `items` plus pagination/count metadata.
 */
export function shapeBookingAssets<
  TAsset extends Parameters<typeof groupAndSortAssetsByKit>[0][number] &
    Parameters<typeof filterBookingAssets>[0][number],
  TKit extends { id: string },
>({
  rawAssets,
  rawKits,
  search,
  orderBy,
  orderDirection,
  page,
  perPage,
  partialCheckinDetails,
  bookingStatus,
}: ShapeBookingAssetsParams<TAsset, TKit>): ShapeBookingAssetsResult<
  TAsset,
  TKit
> {
  // 1. Search-filter (with kit re-expansion).
  const filtered = filterBookingAssets(rawAssets, search);

  // 2. Group by kit + sort. A row sorts into the checked-out (bottom) bucket
  //    when its resolved badge status is CHECKED_OUT.
  const sortedAssets = groupAndSortAssetsByKit(
    filtered,
    orderBy,
    orderDirection,
    {
      isCheckedOut: (asset) =>
        isBookingRowCheckedOut(asset, partialCheckinDetails, bookingStatus),
    }
  );

  // 4. Build pagination items (kits grouped, individual assets separate).
  const paginationItems: BookingPaginationItem<TAsset, TKit>[] = [];
  const processedKitIds = new Set<string>();
  for (const asset of sortedAssets) {
    if (asset.kitId && asset.kit) {
      if (!processedKitIds.has(asset.kitId)) {
        processedKitIds.add(asset.kitId);
        paginationItems.push({
          type: "kit",
          id: asset.kitId,
          assets: sortedAssets.filter((a) => a.kitId === asset.kitId),
        });
      }
    } else {
      paginationItems.push({ type: "asset", id: asset.id, assets: [asset] });
    }
  }

  // 5. Paginate.
  const totalPaginationItems = paginationItems.length;
  const totalPages = Math.ceil(totalPaginationItems / perPage);
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const paginatedItems = paginationItems.slice(skip, skip + perPage);

  // 6. Attach the enriched kit object to each kit row on the current page.
  const kitsMap = new Map(rawKits.map((kit) => [kit.id, kit]));
  const items = paginatedItems.map((item) => ({
    ...item,
    kit: item.type === "kit" ? kitsMap.get(item.id) ?? null : null,
  }));

  return {
    items,
    totalPaginationItems,
    totalPages,
    totalKits: paginationItems.filter((i) => i.type === "kit").length,
    assetsCount: paginationItems.filter((i) => i.type === "asset").length,
  };
}

/**
 * A booking row that collapses every slice one asset holds on the booking, as
 * the mobile booking detail sends it.
 */
type CollapsedBookingAsset = Parameters<
  typeof groupAndSortAssetsByKit
>[0][number] & {
  /** The asset's `AssetType`; quantity-tracked slices are judged by units. */
  type: string;
  /** One entry per `BookingAsset` slice the row holds, with its booked units. */
  slices: ReadonlyArray<{ bookingAssetId: string; quantity: number }>;
};

/** Inputs for {@link sortCollapsedBookingAssets}. */
export interface SortCollapsedBookingAssetsParams<TAsset> {
  /** The booking's rows, one per asset. */
  assets: TAsset[];
  /** Units each quantity-tracked slice has checked out, by `BookingAsset.id`. */
  checkedOutByBookingAsset: ReadonlyMap<string, number>;
  /**
   * Units each quantity-tracked slice has had returned, consumed, lost or
   * damaged, by `BookingAsset.id`.
   */
  dispositionedByBookingAsset: ReadonlyMap<string, number>;
  /** The booking's partial check-in records, keyed by asset id. */
  partialCheckinDetails: PartialCheckinDetailsType;
  /** Parent booking status — drives booking-context checked-out resolution. */
  bookingStatus: string;
}

/**
 * Orders rows that each collapse one asset's slices in the booking overview's
 * default order: Status, descending. Rows still to check out come first and
 * checked-out rows sink to the bottom; a kit sorts as one unit with its members
 * kept together, and ties go A→Z by name (a kit by its own name).
 *
 * Each slice is judged by the same rule the booking overview applies to its
 * rows. A collapsed row counts as checked out only when every slice it holds
 * does, just as a kit counts as checked out only when every member does. A
 * quantity-tracked asset booked both standalone and through a kit is a single
 * row here, so it stays on top while any of its slices still has units to
 * check out. Every other row holds one slice and is judged exactly as the
 * booking overview judges it.
 *
 * @returns The rows in display order, with each kit's members contiguous.
 */
export function sortCollapsedBookingAssets<
  TAsset extends CollapsedBookingAsset,
>({
  assets,
  checkedOutByBookingAsset,
  dispositionedByBookingAsset,
  partialCheckinDetails,
  bookingStatus,
}: SortCollapsedBookingAssetsParams<TAsset>): TAsset[] {
  // The booking overview's default sort. The phone offers no sort control, so
  // this is the only order it shows.
  return groupAndSortAssetsByKit(assets, "status", "desc", {
    isCheckedOut: (asset) =>
      asset.slices.every((slice) =>
        isBookingRowCheckedOut(
          {
            id: asset.id,
            status: asset.status,
            type: asset.type,
            bookedQuantity: slice.quantity,
            checkedOutQuantity:
              checkedOutByBookingAsset.get(slice.bookingAssetId) ?? 0,
            dispositionedQuantity:
              dispositionedByBookingAsset.get(slice.bookingAssetId) ?? 0,
          },
          partialCheckinDetails,
          bookingStatus
        )
      ),
  });
}
