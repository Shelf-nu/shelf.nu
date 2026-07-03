/** In this file you can find the different ways of fetching data for the asset index. They are either for the simple or advanced mode */

import type { AssetIndexSettings, Kit } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { data, redirect } from "react-router";
import type { HeaderData } from "~/components/layout/header/types";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import type { AllowedModelNames } from "~/routes/api+/model-filters";
import { getClientHint } from "~/utils/client-hints";
import {
  getAdvancedFiltersFromRequest,
  getFiltersFromRequest,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import { computeHasActiveFilters } from "~/utils/filter-params";
import { payload, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { parseMarkdownToReact } from "~/utils/md";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { canImportAssets } from "~/utils/subscription.server";
import { resolveUserDisplayName } from "~/utils/user";
import { parseFiltersWithHierarchy } from "./query.server";
import {
  getAdvancedPaginatedAndFilterableAssets,
  getEntitiesWithSelectedValues,
  getPaginatedAndFilterableAssets,
  refreshExpiredAssetImages,
  updateAssetsWithBookingCustodians,
} from "./service.server";
import { getAllSelectedValuesFromFilters } from "./utils.server";
import { MAX_SAVED_FILTER_PRESETS } from "../asset-filter-presets/constants";
import { listPresetsForUser } from "../asset-filter-presets/service.server";
import type { Column } from "../asset-index-settings/helpers";
import { getActiveCustomFields } from "../custom-field/service.server";
import type { OrganizationFromUser } from "../organization/service.server";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
import { getTagsForBookingTagsFilter } from "../tag/service.server";
import {
  getTeamMemberForCustodianFilter,
  getTeamMemberForForm,
  getTeamMembersForNotify,
} from "../team-member/service.server";
import { getOrganizationTierLimit } from "../tier/service.server";

interface Props {
  request: Request;
  userId: string;
  organizationId: string;
  organizations: OrganizationFromUser[];
  role: OrganizationRoles;
  currentOrganization: OrganizationFromUser;
  user: { firstName: string | null };
  settings: AssetIndexSettings;
}

const searchFieldTooltipText = `
Search assets based on asset fields. Separate your keywords by a comma(,) to search with OR condition. Supported fields are: 
- Asset ID
- Name
- Description
- Category
- Location
- Tags
- Custodian names (first or last name)
- QR code value
- Custom field values
- Barcodes values
`;

/** Minimal structural shape of one BookingAsset pivot row returned under the
 * availability `extraInclude`. Only the fields this helper reads/writes. */
type MutableBookingAssetSlice = {
  assetKitId: string | null;
  kitId?: string | null;
  kitName?: string | null;
};

/**
 * Attaches the kit name (and kit id) onto every kit-driven BookingAsset slice.
 *
 * `BookingAsset.assetKitId` is a bare FK with no Prisma relation accessor, so
 * the kit name cannot be nested-selected. This resolves all names in ONE
 * org-scoped read and mutates the slices in place. Standalone slices
 * (assetKitId === null) are left untouched. Availability view only.
 *
 * Kit names are supplementary UI data, so the availability loader wraps this
 * call and degrades gracefully (logs + continues) if the read fails — the raw
 * Prisma error propagates here and is handled at the call site rather than
 * being rethrown as a ShelfError.
 *
 * @param args.assets - Loaded assets, each optionally carrying `bookingAssets`.
 * @param args.organizationId - Active org; scopes the AssetKit read (defense in
 *   depth per org-scope-user-supplied-ids).
 */
export async function attachKitNamesToBookingAssets({
  assets,
  organizationId,
}: {
  assets: Array<{ bookingAssets?: MutableBookingAssetSlice[] }>;
  organizationId: string;
}): Promise<void> {
  const assetKitIds = Array.from(
    new Set(
      assets.flatMap((a) =>
        (a.bookingAssets ?? [])
          .map((ba) => ba.assetKitId)
          .filter((id): id is string => id !== null)
      )
    )
  );
  if (assetKitIds.length === 0) return;

  const assetKits = await db.assetKit.findMany({
    where: { id: { in: assetKitIds }, organizationId },
    select: { id: true, kit: { select: { id: true, name: true } } },
  });
  const byId = new Map(assetKits.map((ak) => [ak.id, ak.kit]));

  for (const a of assets) {
    for (const ba of a.bookingAssets ?? []) {
      if (ba.assetKitId) {
        const kit = byId.get(ba.assetKitId);
        ba.kitId = kit?.id ?? null;
        ba.kitName = kit?.name ?? null;
      }
    }
  }
}

export async function simpleModeLoader({
  request,
  userId,
  organizationId,
  organizations,
  role,
  currentOrganization,
  user,
  settings,
}: Props) {
  const { locale, timeZone } = getClientHint(request);
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;
  const isSelfServiceOrBase =
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE;

  // Check if URL contains advanced filter syntax (from browser back button or old bookmark)
  // URLSearchParams.toString() encodes colons as %3A, so we must check the decoded values
  const urlSearchParams = getCurrentSearchParams(request);
  let hasAdvancedSyntax = false;

  for (const value of urlSearchParams.values()) {
    if (/(is|contains|gt|lt|gte|lte|eq|ne|startsWith|endsWith):/.test(value)) {
      hasAdvancedSyntax = true;
      break;
    }
  }

  if (hasAdvancedSyntax) {
    // URL has advanced syntax but we're in simple mode - redirect to clean URL
    // This handles browser back button after mode switch
    return redirect("/assets");
  }

  /** Parse filters */
  const {
    filters,
    serializedCookie: filtersCookie,
    redirectNeeded,
  } = await getFiltersFromRequest(request, organizationId, {
    name: "assetFilter_v2",
    path: "/", // Use root path so cookie is sent with RR7 single fetch .data requests
  });

  if (filters && redirectNeeded) {
    const cookieParams = new URLSearchParams(filters);
    return redirect(`/assets?${cookieParams.toString()}`);
  }

  const searchParams = getCurrentSearchParams(request);
  const hasActiveFilters = computeHasActiveFilters(searchParams);
  const view = searchParams.get("view") ?? "table";

  /** Query tierLimit, assets, presets, permissions & more — all in parallel */
  let [
    tierLimit,
    {
      search,
      totalAssets,
      perPage,
      page,
      categories,
      tags,
      assets,
      totalPages,
      cookie,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
    },
    tagsData,
    teamMembersForFormData,
    notifyData,
    savedFilterPresets,
    canImport,
  ] = await Promise.all([
    getOrganizationTierLimit({
      organizationId,
      organizations,
    }),
    getPaginatedAndFilterableAssets({
      request,
      organizationId,
      filters,
      extraInclude:
        view === "availability"
          ? {
              bookingAssets: {
                where: {
                  booking: {
                    status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                  },
                },
                include: {
                  booking: {
                    select: {
                      id: true,
                      name: true,
                      status: true,
                      from: true,
                      to: true,
                      description: true,
                      custodianTeamMember: true,
                      custodianUser: true,
                      tags: TAG_WITH_COLOR_SELECT,
                      creator: {
                        select: {
                          id: true,
                          firstName: true,
                          lastName: true,
                          displayName: true,
                          profilePicture: true,
                        },
                      },
                    },
                  },
                },
              },
            }
          : undefined,
      isSelfService,
      userId,
    }),
    getTagsForBookingTagsFilter({
      organizationId,
    }),
    // Team members for booking form - BASE/SELF_SERVICE always get their team member
    isSelfServiceOrBase
      ? getTeamMemberForForm({
          organizationId,
          userId,
          isSelfServiceOrBase,
          getAll:
            searchParams.has("getAll") &&
            hasGetAllValue(searchParams, "teamMember"),
        })
      : Promise.resolve(null),
    getTeamMembersForNotify({ organizationId }),
    // Saved filter presets — only depends on organizationId + userId
    listPresetsForUser({
      organizationId,
      ownerId: userId,
    }),
    // Import permission — only depends on organizationId, userId, role
    hasPermission({
      organizationId,
      userId,
      roles: role ? [role] : [],
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    }),
  ]);

  const currentUserTeamMember = isSelfService
    ? teamMembers.find((tm) => tm.userId === userId) ?? null
    : null;

  // Synchronous — no DB call. Booking custodian data is already included
  // in the initial asset query (via assetIndexFields), so this just reshapes
  // it into the `custody.custodian` structure the UI expects.
  assets = updateAssetsWithBookingCustodians(assets);

  // Refresh expired signed URLs before returning so users never see broken images.
  // Runs after the main query completes but is awaited to ensure fresh URLs.
  // With 72h expiration, this path is hit infrequently.
  try {
    assets = await refreshExpiredAssetImages(assets);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to batch refresh expired asset images",
        label: "Assets",
        additionalData: { assetCount: assets.length },
        shouldBeCaptured: true,
      })
    );
  }

  // Availability view only: resolve kit names for kit-driven booking slices so
  // the calendar can show per-slice attribution. `assetKitId`/`quantity` are
  // already present (BookingAsset scalars via the include). One `as unknown as`
  // structural cast — `bookingAssets` is an availability-only extraInclude not
  // in the base asset type (same pattern the availability hook uses).
  if (view === "availability") {
    // Kit-name attribution is supplementary UI data — mirror the graceful
    // degradation of the image-refresh above so a transient AssetKit read
    // failure logs and continues instead of 500-ing the whole availability
    // page. The calendar simply falls back to "via a kit" without the name.
    try {
      await attachKitNamesToBookingAssets({
        assets: assets as unknown as Array<{
          bookingAssets?: MutableBookingAssetSlice[];
        }>,
        organizationId,
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Failed to attach kit names to booking assets",
          label: "Assets",
          additionalData: { organizationId, assetCount: assets.length },
          shouldBeCaptured: true,
        })
      );
    }
  }

  const userName = resolveUserDisplayName(user);
  const header: HeaderData = {
    title: isPersonalOrg(currentOrganization)
      ? userName
        ? `${userName}'s inventory`
        : `Your inventory`
      : currentOrganization?.name
      ? `${currentOrganization?.name}'s inventory`
      : "Your inventory",
  };

  const modelName = {
    singular: "asset",
    plural: "assets",
  };

  const userPrefsCookie = await userPrefs.serialize(cookie);
  const headers = [
    setCookie(userPrefsCookie),
    ...(filtersCookie ? [setCookie(filtersCookie)] : []),
  ];

  return data(
    payload({
      header,
      items: assets,
      categories,
      tags,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName,
      hasActiveFilters,
      canImportAssets: canImportAssets(tierLimit) && canImport,
      searchFieldLabel: "Search assets",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: parseMarkdownToReact(searchFieldTooltipText),
      },
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
      currentUserTeamMember,
      teamMembersForForm: teamMembersForFormData?.teamMembers ?? teamMembers,
      ...notifyData,
      filters,
      organizationId,
      locale,
      timeZone,
      currentOrganization,
      settings,
      /**
       * We return an empty array in simple mode for easier to manage types
       * Those are fields we need in advanced mode and this helps us prevent type issues.
       * */
      customFields: [],
      kits: [] as Kit[],
      totalKits: 0,
      bookings: [] as { id: string; name: string }[],
      totalBookings: 0,
      // Those tags are used for the tags autocomplete on the booking form
      tagsData,
      // Saved filter presets
      savedFilterPresets,
      savedFilterPresetLimit: MAX_SAVED_FILTER_PRESETS,
    }),
    {
      headers,
    }
  );
}

export async function advancedModeLoader({
  request,
  userId,
  organizationId,
  organizations,
  role,
  currentOrganization,
  user,
  settings,
}: Props) {
  const { locale, timeZone } = getClientHint(request);
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;
  const isSelfServiceOrBase = isSelfService || role === OrganizationRoles.BASE;

  /** Parse filters */
  const {
    filters,
    serializedCookie: filtersCookie,
    redirectNeeded,
  } = await getAdvancedFiltersFromRequest(request, organizationId, settings);

  const currentFilterParams = new URLSearchParams(filters || "");
  const searchParams = filters
    ? currentFilterParams
    : getCurrentSearchParams(request);
  const hasActiveFilters = computeHasActiveFilters(searchParams);
  const allSelectedEntries = searchParams.getAll(
    "getAll"
  ) as AllowedModelNames[];
  const view = searchParams.get("view") ?? "table";

  const paramsValues = getParamsValues(searchParams);
  const { teamMemberIds } = paramsValues;

  if (redirectNeeded) {
    const cookieParams = new URLSearchParams(filters);
    return redirect(`/assets?${cookieParams.toString()}`, {
      headers: filtersCookie ? [setCookie(filtersCookie)] : undefined,
    });
  }

  // Parse and expand location hierarchy filters ONCE — this avoids redundant
  // DB calls that were previously happening in both getAllSelectedValuesFromFilters
  // and getAdvancedPaginatedAndFilterableAssets independently.
  const parsedFilters = await parseFiltersWithHierarchy(
    filters ?? "",
    settings.columns as Column[],
    organizationId
  );

  const {
    selectedTags,
    selectedCategory,
    selectedLocation,
    selectedAssetModel,
  } = await getAllSelectedValuesFromFilters(
    filters,
    settings.columns as Column[],
    organizationId,
    parsedFilters
  );

  // getEntitiesWithSelectedValues fetches filter dropdown options (tags,
  // categories, locations, asset models). Its output is only used in the final
  // response payload — no other query depends on it. Running it inside
  // Promise.all lets it overlap with the asset query instead of blocking it.
  /** Query entities, tierLimit, assets & more — all in parallel */
  const [
    {
      tags,
      totalTags,
      categories,
      totalCategories,
      locations,
      totalLocations,
      assetModels,
      totalAssetModels,
    },
    tierLimit,
    { search, totalAssets, perPage, page, assets, totalPages, cookie },
    customFields,
    teamMembersData,
    kits,
    totalKits,
    tagsData,
    teamMembersForFormData,
    bookings,
    totalBookings,
    advNotifyData,
    advSavedFilterPresets,
    advCanImport,
  ] = await Promise.all([
    getEntitiesWithSelectedValues({
      organizationId,
      allSelectedEntries,
      selectedTagIds: selectedTags,
      selectedCategoryIds: selectedCategory,
      selectedLocationIds: selectedLocation,
      selectedAssetModelIds: selectedAssetModel,
    }),
    getOrganizationTierLimit({
      organizationId,
      organizations,
    }),
    getAdvancedPaginatedAndFilterableAssets({
      request,
      organizationId,
      filters,
      settings,
      getBookings: view === "availability",
      canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
      availableToBookOnly: role === OrganizationRoles.SELF_SERVICE,
      preParsedFilters: parsedFilters,
    }),
    // We need the custom fields so we can create the options for filtering
    getActiveCustomFields({
      organizationId,
      includeAllCategories: true,
    }),

    // team members/custodian for filters
    getTeamMemberForCustodianFilter({
      organizationId,
      selectedTeamMembers: teamMemberIds,
      getAll:
        searchParams.has("getAll") &&
        hasGetAllValue(searchParams, "teamMember"),
      userId,
    }),

    // Kits
    db.kit.findMany({
      where: { organizationId },
      take:
        searchParams.has("getAll") && hasGetAllValue(searchParams, "kit")
          ? undefined
          : 12,
    }),
    db.kit.count({ where: { organizationId } }),
    // Tags for booking form
    getTagsForBookingTagsFilter({
      organizationId,
    }),
    // Team members for booking form - BASE/SELF_SERVICE always get their team member
    isSelfServiceOrBase
      ? getTeamMemberForForm({
          organizationId,
          userId,
          isSelfServiceOrBase,
          getAll:
            searchParams.has("getAll") &&
            hasGetAllValue(searchParams, "teamMember"),
        })
      : Promise.resolve(null),

    // Bookings for filter dropdown (upcoming bookings only)
    db.booking.findMany({
      where: {
        organizationId,
        status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
      },
      select: { id: true, name: true },
      take:
        searchParams.has("getAll") && hasGetAllValue(searchParams, "booking")
          ? undefined
          : 12,
      orderBy: { from: "asc" },
    }),
    db.booking.count({
      where: {
        organizationId,
        status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
      },
    }),
    getTeamMembersForNotify({ organizationId }),
    // Saved filter presets — only depends on organizationId + userId
    listPresetsForUser({
      organizationId,
      ownerId: userId,
    }),
    // Import permission — only depends on organizationId, userId, role
    hasPermission({
      organizationId,
      userId,
      roles: role ? [role] : [],
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    }),
  ]);

  const currentUserTeamMember = isSelfService
    ? teamMembersData.teamMembers.find((tm) => tm.userId === userId) ?? null
    : null;

  // Refresh expired signed URLs before returning so users never see broken images.
  // With 72h expiration, this path is hit infrequently.
  let refreshedAssets = assets;
  try {
    refreshedAssets = await refreshExpiredAssetImages(assets);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to batch refresh expired asset images",
        label: "Assets",
        additionalData: { assetCount: refreshedAssets.length },
        shouldBeCaptured: true,
      })
    );
  }

  const userName = resolveUserDisplayName(user);
  const header: HeaderData = {
    title: isPersonalOrg(currentOrganization)
      ? userName
        ? `${userName}'s inventory`
        : `Your inventory`
      : currentOrganization?.name
      ? `${currentOrganization?.name}'s inventory`
      : "Your inventory",
  };

  const modelName = {
    singular: "asset",
    plural: "assets",
  };

  const userPrefsCookie = await userPrefs.serialize(cookie);
  const headers = [
    setCookie(userPrefsCookie),
    ...(filtersCookie ? [setCookie(filtersCookie)] : []),
  ];

  return data(
    payload({
      header,
      items: refreshedAssets,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName,
      hasActiveFilters,
      canImportAssets: canImportAssets(tierLimit) && advCanImport,
      searchFieldLabel: "Search assets",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: parseMarkdownToReact(searchFieldTooltipText),
      },
      filters,
      organizationId,
      locale,
      timeZone,
      currentOrganization,
      settings,

      customFields,
      ...teamMembersData,
      currentUserTeamMember,
      teamMembersForForm:
        teamMembersForFormData?.teamMembers ?? teamMembersData.teamMembers,
      ...advNotifyData,
      categories,
      totalCategories,
      locations,
      totalLocations,
      kits,
      totalKits,
      tags,
      totalTags,
      tagsData,
      bookings,
      totalBookings,
      assetModels,
      totalAssetModels,
      // Saved filter presets
      savedFilterPresets: advSavedFilterPresets,
      savedFilterPresetLimit: MAX_SAVED_FILTER_PRESETS,
    }),
    {
      headers,
    }
  );
}
