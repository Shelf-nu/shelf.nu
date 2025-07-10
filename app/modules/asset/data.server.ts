/** In this file you can find the different ways of fetching data for the asset index. They are either for the simple or advanced mode */

import type { AssetIndexSettings, Kit } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
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
import { data, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { parseMarkdownToReact } from "~/utils/md";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { canImportAssets } from "~/utils/subscription.server";
import {
  getAdvancedPaginatedAndFilterableAssets,
  getEntitiesWithSelectedValues,
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "./service.server";
import { getAllSelectedValuesFromFilters } from "./utils.server";
import type { Column } from "../asset-index-settings/helpers";
import { getActiveCustomFields } from "../custom-field/service.server";
import type { OrganizationFromUser } from "../organization/service.server";
import { getTeamMemberForCustodianFilter } from "../team-member/service.server";
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
- Name
- Description
- Category
- Location
- Tags
- Custodian names (first or last name)
- QR code value
- Custom field values
`;

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
  /** Parse filters */
  const {
    filters,
    serializedCookie: filtersCookie,
    redirectNeeded,
  } = await getFiltersFromRequest(request, organizationId, {
    name: "assetFilter",
    path: "/assets",
  });

  if (filters && redirectNeeded) {
    const cookieParams = new URLSearchParams(filters);
    return redirect(`/assets?${cookieParams.toString()}`);
  }

  const searchParams = getCurrentSearchParams(request);
  const view = searchParams.get("view") ?? "table";

  /** Query tierLimit, assets & Asset index settings */
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
              bookings: {
                where: {
                  status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                },
                select: {
                  id: true,
                  name: true,
                  status: true,
                  from: true,
                  to: true,
                  description: true,
                  custodianTeamMember: true,
                  custodianUser: true,
                  tags: { select: { id: true, name: true } },
                },
              },
            }
          : undefined,
      isSelfService,
      userId,
    }),
  ]);

  if (isSelfService) {
    /**
     * For self service users we dont return the assets that are not available to book
     */
    assets = assets.filter((a) => a.availableToBook);
  }

  assets = await updateAssetsWithBookingCustodians(assets);

  const header: HeaderData = {
    title: isPersonalOrg(currentOrganization)
      ? user?.firstName
        ? `${user.firstName}'s inventory`
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

  return json(
    data({
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
      canImportAssets:
        canImportAssets(tierLimit) &&
        (await hasPermission({
          organizationId,
          userId,
          roles: role ? [role] : [],
          entity: PermissionEntity.asset,
          action: PermissionAction.import,
        })),
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

  const { selectedTags, selectedCategory, selectedLocation } =
    getAllSelectedValuesFromFilters(filters, settings.columns as Column[]);

  const {
    tags,
    totalTags,
    categories,
    totalCategories,
    locations,
    totalLocations,
  } = await getEntitiesWithSelectedValues({
    organizationId,
    allSelectedEntries,
    selectedTagIds: selectedTags,
    selectedCategoryIds: selectedCategory,
    selectedLocationIds: selectedLocation,
  });

  /** Query tierLimit, assets & Asset index settings */
  let [
    tierLimit,
    { search, totalAssets, perPage, page, assets, totalPages, cookie },
    customFields,
    teamMembersData,
    kits,
    totalKits,
  ] = await Promise.all([
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
    }),
    // We need the custom fields so we can create the options for filtering
    getActiveCustomFields({
      organizationId,
      includeAllCategories: true,
    }),

    // team members/custodian
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
  ]);

  if (role === OrganizationRoles.SELF_SERVICE) {
    /**
     * For self service users we dont return the assets that are not available to book
     */
    assets = assets.filter((a) => a.availableToBook);
  }

  const header: HeaderData = {
    title: isPersonalOrg(currentOrganization)
      ? user?.firstName
        ? `${user.firstName}'s inventory`
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

  return json(
    data({
      header,
      items: assets,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName,
      canImportAssets:
        canImportAssets(tierLimit) &&
        (await hasPermission({
          organizationId,
          userId,
          roles: role ? [role] : [],
          entity: PermissionEntity.asset,
          action: PermissionAction.import,
        })),
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
      categories,
      totalCategories,
      locations,
      totalLocations,
      kits,
      totalKits,
      tags,
      totalTags,
    }),
    {
      headers,
    }
  );
}
