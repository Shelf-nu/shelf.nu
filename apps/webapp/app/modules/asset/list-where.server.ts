/**
 * Asset List Where
 *
 * Builds the Prisma `where` for a simple-mode asset list: the asset index, the
 * kit, location and booking pickers, and every other list served by
 * `getAssets`. Two steps, kept apart so each can be reused on its own:
 *
 * - `resolveAssetListFilters` maps a list URL to the filters the list applies.
 * - `buildAssetListWhere` turns those filters into the `where` clause.
 *
 * Any code that has to re-run a list's query (for example "select all"
 * expanding to the ids the list shows) goes through these two functions, so
 * it always matches the same assets as the list itself.
 *
 * @see {@link file://./service.server.ts} `getAssets` and `getPaginatedAndFilterableAssets`
 */
import type {
  Asset,
  Booking,
  Category,
  Location,
  Organization,
  Prisma,
  Tag,
  TeamMember,
} from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getParamsValues } from "~/utils/list";
import { bookableListScopeWhere } from "./list-scope.server";
import type { BookableListScope } from "./list-scope.server";
import { resolveAssetSearchIds } from "./search-ids.server";
import { buildAssetStatusWhere, splitAssetSearchTerms } from "./search.server";
import {
  andAssetWhere,
  applyArchivedFilter,
  applyCustodianAllowList,
  buildLowStockWhere,
  getArchivedFilterFromParams,
  type AllowedCustodianFilterIds,
  type ArchivedFilter,
} from "./utils.server";

const label: ErrorLabel = "Assets";

/**
 * The filters a simple-mode asset list applies. Everything that decides which
 * assets the list matches lives here; paging, ordering and the include do not.
 */
export type AssetListFilters = {
  organizationId: Organization["id"];
  search?: string | null;
  categoriesIds?: Category["id"][] | null;
  locationIds?: Location["id"][] | null;
  tagsIds?: Tag["id"][] | null;
  status?: Asset["status"] | null;
  hideUnavailable?: Asset["availableToBook"];
  bookingFrom?: Booking["from"];
  bookingTo?: Booking["to"];
  unhideAssetsBookigIds?: Booking["id"][];
  teamMemberIds?: TeamMember["id"][] | null;
  assetKitFilter?: string | null;
  /** QUANTITY_TRACKED assets at or below their minimum only. */
  lowStockOnly?: boolean;
  /** The caller's list scope; `null` or omitted lists every asset. */
  bookableScope?: BookableListScope | null;
  /**
   * Active/Archived/All view dimension (orthogonal to `status`). Defaults to
   * `active`, so every caller hides archived assets unless it opts in.
   */
  archivedFilter?: ArchivedFilter;
};

/**
 * Builds the Prisma `where` a simple-mode asset list matches.
 *
 * Every filter is its own group in `where.AND`, so each one narrows the list
 * and none can widen another.
 *
 * @param filters - The list's filters (see `resolveAssetListFilters` for the URL mapping)
 * @returns The `where` clause for `db.asset.findMany` / `db.asset.count`
 * @throws {ShelfError} 400 from `resolveAssetSearchIds` when a search matches
 *   more ids than Postgres can bind; callers must pass it through unchanged
 * @throws {ShelfError} When `hideUnavailable` is set without both booking dates
 */
export async function buildAssetListWhere(
  filters: AssetListFilters
): Promise<Prisma.AssetWhereInput> {
  const {
    organizationId,
    search,
    categoriesIds,
    locationIds,
    tagsIds,
    status,
    bookingFrom,
    bookingTo,
    hideUnavailable,
    unhideAssetsBookigIds,
    teamMemberIds,
    assetKitFilter,
    lowStockOnly,
    bookableScope,
    archivedFilter = "active",
  } = filters;

  const where: Prisma.AssetWhereInput = { organizationId };

  // Active/Archived/All dimension (defaults to active = hide archived).
  // Sits on the top-level `where`, so it ANDs with the search id set
  // below: the UNION resolves candidate ids across all assets, then Prisma
  // filters them by archived state. No re-query is needed on this path.
  applyArchivedFilter(where, archivedFilter);

  // Every filter below is its own group in `where.AND` (see andAssetWhere),
  // so each one narrows the list and none can widen another.
  if (bookableScope) {
    andAssetWhere(where, bookableListScopeWhere(bookableScope));
  }

  if (lowStockOnly) {
    andAssetWhere(where, buildLowStockWhere());
  }

  if (search) {
    const searchTerms = splitAssetSearchTerms(search);

    if (searchTerms.length === 0) {
      // Typed input that yields zero terms (whitespace / bare commas)
      // matches NOTHING: a debounced type-ahead sending a single space
      // must not return the full list. Mirrors the mobile composer.
      where.id = { in: [] };
    } else {
      // Resolve the search to a set of matching asset ids via the shared
      // org-scoped UNION (resolveAssetSearchIds → buildAssetSearchUnion), whose
      // branches are index-driven and org-scoped. The helper is retry-wrapped (to claim the read
      // semantics the client extension cannot infer) and guards the id set
      // against Postgres' ~65k bind-param ceiling, throwing a friendly 400
      // rather than letting an extreme org + very broad term hard-fail.
      // The UNION always searches all 11 sources, so id-shaped searches
      // return the full result set. The id set is ANDed with the category,
      // tag, location and custodian filters below: a filter narrows a
      // search, it never adds rows the search did not match.
      const ids = await resolveAssetSearchIds({
        organizationId,
        terms: searchTerms,
      });
      andAssetWhere(where, { id: { in: ids } });
    }
  }

  if (status) {
    // why: Asset.status flips to IN_CUSTODY/CHECKED_OUT for QUANTITY_TRACKED
    // assets as soon as ANY unit is allocated, even if other units remain
    // available. Filtering with `where.status = AVAILABLE` would incorrectly
    // exclude qty-tracked rows that still have free stock. Treat AVAILABLE
    // as inclusive of all qty-tracked rows; row.status keeps the existing
    // strict semantic for IN_CUSTODY / CHECKED_OUT (which are already
    // truthful for qty-tracked: the row enters those states whenever ANY
    // unit does).
    if (status === AssetStatus.AVAILABLE) {
      // QT-aware fragment shared with getAssetsWhereInput and the mobile
      // assets endpoint. See buildAssetStatusWhere for the rationale.
      andAssetWhere(where, buildAssetStatusWhere(status));
    } else {
      where.status = status;
    }
  }

  if (categoriesIds?.length) {
    if (categoriesIds.includes("uncategorized")) {
      andAssetWhere(where, {
        OR: [{ categoryId: { in: categoriesIds } }, { categoryId: null }],
      });
    } else {
      where.categoryId = { in: categoriesIds };
    }
  }

  if (hideUnavailable) {
    //not disabled for booking
    where.availableToBook = true;
    /**
     * For INDIVIDUAL assets, exclude those with active custody.
     * For QUANTITY_TRACKED assets, always show them: partial availability
     * is checked at booking time based on available quantity.
     */
    andAssetWhere(where, {
      OR: [{ type: "QUANTITY_TRACKED" }, { custody: { none: {} } }],
    });
    if (bookingFrom && bookingTo) {
      /**
       * Booking overlap filters only apply to INDIVIDUAL assets.
       * QUANTITY_TRACKED assets can have multiple overlapping bookings
       * as long as total reserved doesn't exceed available quantity.
       * Availability is validated at booking time, not at filter time.
       */
      // Rule 1: Exclude INDIVIDUAL assets from RESERVED bookings
      andAssetWhere(where, {
        OR: [
          { type: "QUANTITY_TRACKED" },
          {
            bookingAssets: {
              none: {
                booking: {
                  ...(unhideAssetsBookigIds?.length && {
                    id: { notIn: unhideAssetsBookigIds },
                  }),
                  status: BookingStatus.RESERVED,
                  OR: [
                    { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                    { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                  ],
                },
              },
            },
          },
        ],
      });
      // Rule 2: For ONGOING/OVERDUE bookings, only exclude CHECKED_OUT INDIVIDUAL assets
      andAssetWhere(where, {
        OR: [
          { type: "QUANTITY_TRACKED" },
          // Either asset is AVAILABLE (checked in from partial check-in)
          { status: AssetStatus.AVAILABLE },
          // Or asset has no conflicting ONGOING/OVERDUE bookings
          {
            bookingAssets: {
              none: {
                booking: {
                  ...(unhideAssetsBookigIds?.length && {
                    id: { notIn: unhideAssetsBookigIds },
                  }),
                  status: {
                    in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                  },
                  OR: [
                    { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                    { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                  ],
                },
              },
            },
          },
        ],
      });
    }
  }
  if (hideUnavailable === true && (!bookingFrom || !bookingTo)) {
    throw new ShelfError({
      cause: null,
      message: "booking dates are needed to hide unavailable assets",
      additionalData: {
        hideUnavailable,
        bookingFrom,
        bookingTo,
      },
      label,
      // The dates come from the list URL: a request without them is a bad
      // request, not a server fault.
      status: 400,
      shouldBeCaptured: false,
    });
  }
  if (bookingFrom && bookingTo) {
    where.availableToBook = true;
  }

  if (tagsIds && tagsIds.length) {
    // One group: assets with any of the picked tags, or with no tags at
    // all when 'untagged' is picked.
    const realTagIds = tagsIds.filter((id) => id !== "untagged");
    andAssetWhere(where, {
      OR: [
        ...(tagsIds.includes("untagged") ? [{ tags: { none: {} } }] : []),
        ...(realTagIds.length > 0
          ? [{ tags: { some: { id: { in: realTagIds } } } }]
          : []),
      ],
    });
  }

  if (locationIds && locationIds.length > 0) {
    if (locationIds.includes("without-location")) {
      andAssetWhere(where, {
        OR: [
          { assetLocations: { some: { locationId: { in: locationIds } } } },
          { assetLocations: { none: {} } },
        ],
      });
    } else {
      where.assetLocations = {
        some: { locationId: { in: locationIds } },
      };
    }
  }

  /**
   * `hideUnavailable` filters INDIVIDUAL assets that are in any kit out
   * of the picker (those are managed via the kit, not picked directly).
   * QUANTITY_TRACKED assets bypass this filter: a partial-kit allocation
   * is a slice, not whole-asset exclusion; the free pool stays bookable
   * as a standalone slice. Picker's availability math subtracts the
   * kit-committed sum downstream so the displayed "Available" count is
   * already correct.
   */
  if (hideUnavailable === true) {
    andAssetWhere(where, {
      OR: [{ type: "QUANTITY_TRACKED" }, { assetKits: { none: {} } }],
    });
  }

  if (teamMemberIds && teamMemberIds.length) {
    andAssetWhere(where, {
      OR: [
        {
          custody: { some: { teamMemberId: { in: teamMemberIds } } },
        },
        {
          custody: {
            some: { custodian: { userId: { in: teamMemberIds } } },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianTeamMemberId: { in: teamMemberIds },
                /** We only get them if the booking is ongoing */
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianUserId: { in: teamMemberIds },
                /** We only get them if the booking is ongoing */
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: { none: {} } }]
          : []),
      ],
    });

    // A refused custodian filter matches nothing, whatever else the group
    // holds. Same guard as getAssetsWhereInput.
    if (teamMemberIds.includes(CUSTODY_FILTER_REFUSED)) {
      andAssetWhere(where, { id: CUSTODY_FILTER_REFUSED });
    }
  }

  if (assetKitFilter === "NOT_IN_KIT") {
    where.assetKits = { none: {} };
  } else if (assetKitFilter === "IN_OTHER_KITS") {
    where.assetKits = { some: {} };
  }

  return where;
}

/** Arguments for `resolveAssetListFilters`. */
type ResolveAssetListFiltersArgs = {
  organizationId: Organization["id"];
  /** The list's URL params (the request URL, or the saved filters cookie). */
  searchParams: URLSearchParams;
  /**
   * Custodian filter ids, already narrowed to what the caller may filter by.
   * The URL's `teamMember` values are never read here: the list loader scopes
   * them with `scopeCustodianFilterIds`, and select-all with
   * `applyCustodianAllowList`.
   */
  teamMemberIds: TeamMember["id"][] | null | undefined;
  /** The caller's list scope (see `resolveBookableListScope`); `null` or omitted lists every asset. */
  bookableScope?: BookableListScope | null;
  /**
   * Location ids the list matches, in place of the URL's `location` values.
   * Omitted, the URL's own values are matched exactly.
   */
  locationIdsOverride?: Location["id"][];
  /** Read the `?archived=` view param; otherwise the list shows active assets. */
  honorArchivedView: boolean;
  /** Read the `?lowStockOnly=true` param; otherwise it is ignored. */
  honorLowStockFilter: boolean;
};

/**
 * Maps a simple-mode list URL to the filters the list applies.
 *
 * Pure and synchronous: the only inputs are the URL and the options the
 * caller states, so a list loader and anything re-running that list's query
 * get the same filters for the same URL.
 *
 * @param args - The URL params and the list's options
 * @returns The filters to hand to `buildAssetListWhere` (or `getAssets`)
 */
export function resolveAssetListFilters({
  organizationId,
  searchParams,
  teamMemberIds,
  bookableScope,
  locationIdsOverride,
  honorArchivedView,
  honorLowStockFilter,
}: ResolveAssetListFiltersArgs): AssetListFilters {
  const {
    search,
    categoriesIds,
    tagsIds,
    bookingFrom,
    bookingTo,
    hideUnavailable,
    unhideAssetsBookigIds,
    locationIds,
    assetKitFilter,
  } = getParamsValues(searchParams);

  /**
   * Only a real `AssetStatus` narrows the list. Anything else (`ALL`, or
   * advanced-mode syntax such as `is:AVAILABLE` carried in a stale URL) is
   * ignored: Prisma rejects an unknown enum value and the request would fail.
   */
  const statusParam = searchParams.get("status");
  const status = (Object.values(AssetStatus) as string[]).includes(
    statusParam ?? ""
  )
    ? (statusParam as AssetStatus)
    : null;

  return {
    organizationId,
    search,
    categoriesIds,
    tagsIds,
    status,
    bookingFrom: bookingFrom ?? undefined,
    bookingTo: bookingTo ?? undefined,
    hideUnavailable,
    unhideAssetsBookigIds,
    locationIds: locationIdsOverride ?? locationIds,
    teamMemberIds,
    assetKitFilter,
    bookableScope,
    archivedFilter: honorArchivedView
      ? getArchivedFilterFromParams(searchParams)
      : "active",
    lowStockOnly:
      honorLowStockFilter && searchParams.get("lowStockOnly") === "true",
  };
}

/**
 * The `where` that "select all" expands to: the same assets the list showed.
 *
 * Runs the list's own query (`resolveAssetListFilters` then
 * `buildAssetListWhere`), so search, scope, picker rules and every filter
 * match the list exactly. Every option is required: pass the values the list's
 * loader passes to `getPaginatedAndFilterableAssets`, or the selection drifts
 * from what the user saw.
 *
 * @param args.currentSearchParams - The list URL's query string, as submitted
 *   with the bulk action
 * @param args.allowedTeamMemberIds - Custodian ids the caller may filter by
 *   (see `applyCustodianAllowList`). A list that refuses every custodian filter
 *   passes `[]`.
 * @returns The Prisma where clause for the selected assets
 * @throws {ShelfError} 400 when a search matches more ids than a query can bind
 */
export async function getAssetListWhereForSelectAll({
  organizationId,
  currentSearchParams,
  allowedTeamMemberIds,
  bookableScope,
  locationIdsOverride,
  honorArchivedView,
  honorLowStockFilter,
}: {
  organizationId: Organization["id"];
  currentSearchParams: string | null | undefined;
  allowedTeamMemberIds: AllowedCustodianFilterIds;
  bookableScope: BookableListScope | null;
  locationIdsOverride: Location["id"][] | undefined;
  honorArchivedView: boolean;
  honorLowStockFilter: boolean;
}): Promise<Prisma.AssetWhereInput> {
  const searchParams = new URLSearchParams(currentSearchParams ?? "");

  return buildAssetListWhere(
    resolveAssetListFilters({
      organizationId,
      searchParams,
      teamMemberIds: applyCustodianAllowList(
        searchParams.getAll("teamMember"),
        allowedTeamMemberIds
      ),
      bookableScope,
      locationIdsOverride,
      honorArchivedView,
      honorLowStockFilter,
    })
  );
}
