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
  caller: ListNavigationCaller;
};

/** How one list is permission-gated and paged. */
export type ListNavigationEntry = {
  /** The permission entity the list's index route requires `read` on. */
  permissionEntity: PermissionEntity;
  /** The list's index path, used to build its request. */
  indexPath: string;
  /**
   * The ids on one page of the list, in list order. Calls the same query
   * function, with the same access-derived arguments, as the list's index
   * loader, so the order and visibility are exactly what the user saw.
   */
  fetchPageIds: (args: FetchPageIdsArgs) => Promise<string[]>;
};

/** One entry per list a detail page can step through. */
export const LIST_NAVIGATION_REGISTRY: Record<ListEntity, ListNavigationEntry> =
  {
    asset: {
      permissionEntity: PermissionEntity.asset,
      indexPath: "/assets",
      fetchPageIds: fetchAssetPageIds,
    },
    booking: {
      permissionEntity: PermissionEntity.booking,
      indexPath: "/bookings",
      fetchPageIds: fetchBookingPageIds,
    },
    kit: {
      permissionEntity: PermissionEntity.kit,
      indexPath: "/kits",
      fetchPageIds: fetchKitPageIds,
    },
    location: {
      permissionEntity: PermissionEntity.location,
      indexPath: "/locations",
      fetchPageIds: fetchLocationPageIds,
    },
  };

/** Mirrors the `/assets` index loader: picks the simple or advanced query like it does. */
async function fetchAssetPageIds({
  listRequest,
  filters,
  caller,
}: FetchPageIdsArgs): Promise<string[]> {
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
    if (!access.policy.ui.advancedAssetIndex) return [];

    const { filters: advancedFilters } = await getAdvancedFiltersFromRequest(
      listRequest,
      organizationId,
      settings
    );
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(listRequest)
    );
    const { assets } = await getAdvancedPaginatedAndFilterableAssets({
      request: listRequest,
      organizationId,
      timeZone,
      filters: advancedFilters,
      settings,
      canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
      bookableScope,
      honorArchivedView,
    });
    return assets.map((asset) => asset.id);
  }

  const { assets } = await getPaginatedAndFilterableAssets({
    request: listRequest,
    organizationId,
    canSeeAllCustody: access.custody.seeAll,
    honorArchivedView,
    honorLowStockFilter: true,
    filters,
    bookableScope,
    userId,
  });
  return assets.map((asset) => asset.id);
}

/** Mirrors the `/bookings` index loader. */
async function fetchBookingPageIds({
  listRequest,
  caller,
}: FetchPageIdsArgs): Promise<string[]> {
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
}: FetchPageIdsArgs): Promise<string[]> {
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
}: FetchPageIdsArgs): Promise<string[]> {
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
