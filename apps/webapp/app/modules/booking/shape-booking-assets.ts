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
 * @see {@link file://../../utils/booking-assets.ts} sortBookingAssets
 * @see docs/superpowers/specs/2026-06-01-booking-asset-search-in-memory-design.md
 */
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import { sortBookingAssets } from "~/utils/booking-assets";
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
}: ShapeBookingAssetsParams<TAsset, TKit>): ShapeBookingAssetsResult<
  TAsset,
  TKit
> {
  // 1. Search-filter (with kit re-expansion).
  const filtered = filterBookingAssets(rawAssets, search);

  // 2. Status sort needs partial check-in date ordering; other fields are
  //    handled entirely by groupAndSortAssetsByKit.
  const isStatusSort = !orderBy || orderBy === "status";
  const listAssets = isStatusSort
    ? sortBookingAssets(filtered, partialCheckinDetails)
    : filtered;

  // 3. Group by kit + apply the sort to assets and kit groups.
  const sortedAssets = groupAndSortAssetsByKit(
    listAssets,
    orderBy,
    orderDirection
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
