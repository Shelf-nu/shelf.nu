/** In this file you can find the different ways of fetching data for the asset index. They are either for the simple or advanced mode */

import type { AssetIndexSettings, Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { HeaderData } from "~/components/layout/header/types";
import { getClientHint } from "~/utils/client-hints";
import {
  getAdvancedFiltersFromRequest,
  getFiltersFromRequest,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { data } from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { canImportAssets } from "~/utils/subscription.server";
import {
  getAdvancedPaginatedAndFilterableAssets,
  getPaginatedAndFilterableAssets,
  updateAssetsWithBookingCustodians,
} from "./service.server";
import { getActiveCustomFields } from "../custom-field/service.server";
import { getOrganizationTierLimit } from "../tier/service.server";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

type Org = Prisma.OrganizationGetPayload<{
  select: {
    id: true;
    type: true;
    name: true;
    imageId: true;
    userId: true;
    updatedAt: true;
    currency: true;
    enabledSso: true;
    owner: {
      select: {
        id: true;
        email: true;
      };
    };
    ssoDetails: true;
  };
}>;

interface Props {
  request: Request;
  userId: string;
  organizationId: string;
  organizations: Org[];
  role: OrganizationRoles;
  currentOrganization: Org;
  user: { firstName: string | null };
  settings: AssetIndexSettings;
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

  /** Parse filters */
  const {
    filters,
    serializedCookie: filtersCookie,
    redirectNeeded,
  } = await getFiltersFromRequest(request, organizationId);

  if (filters && redirectNeeded) {
    const cookieParams = new URLSearchParams(filters);
    return redirect(`/assets?${cookieParams.toString()}`);
  }

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
      rawTeamMembers,
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
        text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
      },
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      teamMembers,
      totalTeamMembers,
      rawTeamMembers,
      filters,
      organizationId,
      locale,
      timeZone,
      currentOrganization,
      settings,
      customFields: [], // we return an empty array in simple mode for easier to manage types
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
  } = await getAdvancedFiltersFromRequest(request, organizationId);

  if (filters && redirectNeeded) {
    const cookieParams = new URLSearchParams(filters);
    return redirect(`/assets?${cookieParams.toString()}`);
  }

  /** Query tierLimit, assets & Asset index settings */
  let [
    tierLimit,
    { search, totalAssets, perPage, page, assets, totalPages, cookie },
    customFields,
    teamMembers,
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
    }),
    // We need the custom fields so we can create the options for filtering
    getActiveCustomFields({
      organizationId,
    }),
    /** We get all the first 12 team members that are part of the org @TODO - change this to a proper function */
    await db.teamMember
      .findMany({
        where: {
          deletedAt: null,
          organizationId,
        },
        include: { user: true },
        orderBy: {
          userId: "asc",
        },
        take: 12,
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching team members. Please try again or contact support.",
          additionalData: { userId, organizationId },
          label: "Assets",
        });
      }),
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
      searchFieldLabel: "Search by asset name",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: "Search assets based on asset name Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
      },
      filters,
      organizationId,
      locale,
      timeZone,
      currentOrganization,
      settings,
      customFields,
      teamMembers,
    }),
    {
      headers,
    }
  );
}
