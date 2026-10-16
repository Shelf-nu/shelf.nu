/**
 * The lists a detail page can step through with its previous/next arrows.
 *
 * Each entry names the permission its index route requires and loads one
 * page of ids through the index's OWN query function, with the same
 * access-derived arguments, so the order and visibility match the list the
 * user saw. Never replace those calls with a hand-written `where`: the index
 * functions carry the bookable scope, custody and archived-view rules.
 */
import { canViewArchivedAssets } from "~/modules/asset/data.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import {
  getAdvancedPaginatedAndFilterableAssets,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  getBookings,
  getBookingsFilterData,
  getBookingsListWhereParams,
} from "~/modules/booking/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { getLocations } from "~/modules/location/service.server";
import { getClientHint } from "~/utils/client-hints";
import {
  getAdvancedFiltersFromRequest,
  updateCookieWithPerPage,
} from "~/utils/cookies.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { getParamsValues } from "~/utils/list";
import { isPersonalOrg } from "~/utils/organization";
import { PermissionEntity } from "~/utils/permissions/permission.data";
import type { requirePermission } from "~/utils/roles.server";
import type { ListEntity } from "./list-context";
import { readPage, withPage } from "./list-context";

/** The caller, as the neighbours endpoint resolved them. */
export type ListNavigationCaller = Awaited<
  ReturnType<typeof requirePermission>
> & { userId: string };

/** Everything a list needs to load one of its pages. */
export type FetchPageIdsArgs = {
  /** The list's own request: its URL is the list URL at the wanted page, its headers the caller's. */
  listRequest: Request;
  /** The list's search string at the wanted page, without the leading `?`. */
  filters: string;
};

/** The ids on one page of a list, in list order. */
export type PageIdsFetcher = (args: FetchPageIdsArgs) => Promise<string[]>;

/** What a list may resolve once per neighbours lookup, before loading pages. */
export type CreatePageFetcherArgs = {
  /** The incoming request, whose headers (cookies, client hints) the list reads. */
  request: Request;
  /** The list's search string, without the leading `?` and with any page. */
  filters: string;
  caller: ListNavigationCaller;
};

/** How one list is permission-gated and paged. */
export type ListNavigationEntry = {
  /** The permission entity the list's index route requires `read` on. */
  permissionEntity: PermissionEntity;
  /** The list's index path, used to build its request. */
  indexPath: string;
  /**
   * Resolves what every page of the list shares (settings, preferences)
   * once, and returns the page loader. The page loader calls the same query
   * function, with the same access-derived arguments, as the list's index
   * loader, so the order and visibility are exactly what the user saw.
   */
  createPageFetcher: (args: CreatePageFetcherArgs) => Promise<PageIdsFetcher>;
};

/** One entry per list a detail page can step through. */
export const LIST_NAVIGATION_REGISTRY: Record<ListEntity, ListNavigationEntry> =
  {
    asset: {
      permissionEntity: PermissionEntity.asset,
      indexPath: "/assets",
      createPageFetcher: createAssetPageFetcher,
    },
    booking: {
      permissionEntity: PermissionEntity.booking,
      indexPath: "/bookings",
      createPageFetcher: ({ caller }) =>
        Promise.resolve((page) => fetchBookingPageIds({ ...page, caller })),
    },
    kit: {
      permissionEntity: PermissionEntity.kit,
      indexPath: "/kits",
      createPageFetcher: ({ caller }) =>
        Promise.resolve((page) => fetchKitPageIds({ ...page, caller })),
    },
    location: {
      permissionEntity: PermissionEntity.location,
      indexPath: "/locations",
      createPageFetcher: ({ caller }) =>
        Promise.resolve((page) => fetchLocationPageIds({ ...page, caller })),
    },
  };

/** A page load with the caller attached. */
type CallerPageArgs = FetchPageIdsArgs & { caller: ListNavigationCaller };

/**
 * Mirrors the `/assets` index loader: picks the simple or advanced query like
 * it does. The index settings, the advanced filter normalisation and the
 * caller's time zone are page-independent, so they resolve once here.
 */
async function createAssetPageFetcher({
  request,
  filters,
  caller,
}: CreatePageFetcherArgs): Promise<PageIdsFetcher> {
  const {
    userId,
    organizationId,
    canUseBarcodes,
    role,
    access,
    currentOrganization,
  } = caller;
  const settings = await getAssetIndexSettings({
    userId,
    organizationId,
    canUseBarcodes,
    role,
  });
  const honorArchivedView = canViewArchivedAssets(access);
  const bookableScope = resolveBookableListScope({ access, userId });

  if (settings.mode === "ADVANCED") {
    // The index refuses the advanced mode to a role without it, so there is
    // no list to step through.
    if (!access.policy.ui.advancedAssetIndex) return () => Promise.resolve([]);

    const origin = new URL(request.url).origin;
    const [{ filters: advancedFilters = "" }, { timeZone }] = await Promise.all(
      [
        getAdvancedFiltersFromRequest(
          new Request(`${origin}/assets?${filters}`, {
            headers: request.headers,
          }),
          organizationId,
          settings
        ),
        resolveUserFormatPrefsById(userId, getClientHint(request)),
      ]
    );

    return async ({ listRequest, filters: pageFilters }) => {
      const { assets } = await getAdvancedPaginatedAndFilterableAssets({
        request: listRequest,
        organizationId,
        timeZone,
        filters: withPage(advancedFilters, readPage(pageFilters)).slice(1),
        settings,
        canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
        bookableScope,
        honorArchivedView,
      });
      return assets.map((asset) => asset.id);
    };
  }

  return async ({ listRequest, filters: pageFilters }) => {
    const { assets } = await getPaginatedAndFilterableAssets({
      request: listRequest,
      organizationId,
      canSeeAllCustody: access.custody.seeAll,
      honorArchivedView,
      honorLowStockFilter: true,
      filters: pageFilters,
      bookableScope,
      userId,
    });
    return assets.map((asset) => asset.id);
  };
}

/** Mirrors the `/bookings` index loader. */
async function fetchBookingPageIds({
  listRequest,
  caller,
}: CallerPageArgs): Promise<string[]> {
  const { userId, organizationId, access, currentOrganization } = caller;
  // The index refuses personal workspaces, so there is no list to step through.
  if (isPersonalOrg(currentOrganization)) return [];

  const {
    page,
    perPage,
    orderBy,
    orderDirection,
    selfServiceData,
    searchParams,
  } = await getBookingsFilterData({
    request: listRequest,
    canSeeAllBookings: access.bookings.seeAll,
    organizationId,
    userId,
  });

  const { bookings } = await getBookings({
    ...getBookingsListWhereParams({
      list: { kind: "index" },
      searchParams,
      organizationId,
      userId,
      custodianScope: selfServiceData?.custodianScope ?? null,
    }),
    page,
    perPage,
    orderBy,
    orderDirection,
    includeAssets: false,
    skipCount: true,
  });
  return bookings.map((booking) => booking.id);
}

/** Mirrors the `/kits` index loader. */
async function fetchKitPageIds({
  listRequest,
  caller,
}: CallerPageArgs): Promise<string[]> {
  const { userId, organizationId, access } = caller;
  const { kits } = await getPaginatedAndFilterableKits({
    request: listRequest,
    organizationId,
    canSeeAllCustody: access.custody.seeAll,
    userId,
    // The index's own include: `?hideUnavailable` drops kits whose active
    // member list is empty, so the list here must load the same members.
    extraInclude: {
      assetKits: {
        where: { asset: { archivedAt: null } },
        select: { id: true },
      },
    },
  });
  return kits.map((kit) => kit.id);
}

/** Mirrors the `/locations` index loader. */
async function fetchLocationPageIds({
  listRequest,
  filters,
  caller,
}: CallerPageArgs): Promise<string[]> {
  const { page, perPageParam, search, orderBy, orderDirection } =
    getParamsValues(new URLSearchParams(filters));
  const { perPage } = await updateCookieWithPerPage(listRequest, perPageParam);
  const { locations } = await getLocations({
    organizationId: caller.organizationId,
    page,
    perPage,
    search,
    orderBy,
    orderDirection,
  });
  return locations.map((location) => location.id);
}
