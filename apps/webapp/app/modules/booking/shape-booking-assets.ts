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
 * @see {@link file://./helpers.ts} filterBookingAssets / groupAndSortAssetsByKit
 * @see {@link file://../../utils/booking-assets.ts} resolveBookingRowQtyState
 * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
 */
import { AssetStatus } from "@prisma/client";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import { resolveBookingRowQtyState } from "~/utils/booking-assets";
import { filterBookingAssets, groupAndSortAssetsByKit } from "./helpers";

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

  // 2. Group by kit + sort. A row counts as "checked out" (bottom bucket) when
  //    its RESOLVED badge status is CHECKED_OUT — computed by the SAME shared
  //    resolver the row badge uses, so the badge a user sees and the bucket the
  //    row sorts into can never disagree. This covers per-slice QT correctly:
  //    a fully-checked-out kit slice sinks even though the multi-slice asset's
  //    GLOBAL status hasn't flipped, while a QT row with a partial return
  //    underway (or DRAFT/RESERVED) stays on top as its actionable state.
  const sortedAssets = groupAndSortAssetsByKit(
    filtered,
    orderBy,
    orderDirection,
    {
      isCheckedOut: (asset) =>
        resolveBookingRowQtyState(asset, partialCheckinDetails, bookingStatus)
          .contextStatus === AssetStatus.CHECKED_OUT,
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
