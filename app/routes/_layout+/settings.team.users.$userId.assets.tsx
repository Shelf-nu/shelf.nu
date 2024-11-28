import { json, redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import {
  getFiltersFromRequest,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { AssetsList } from "./assets._index";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMemberProfile,
      action: PermissionAction.read,
    });

    const { userId: selectedUserId } = getParams(
      params,
      z.object({ userId: z.string() }),
      {
        additionalData: { userId },
      }
    );
    const { filters, redirectNeeded } = await getFiltersFromRequest(
      request,
      organizationId
    );

    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/assets?${cookieParams.toString()}`);
    }

    /**
     * We have to protect against bad actors adding teamMember param in the url and getting the assets from another team member
     * In this view there could only be 1 team member this is scoped to and that is the user we are currently viewing: selectedUserId
     * */
    const filtersSearchParams = new URLSearchParams(filters);
    filtersSearchParams.set("teamMember", selectedUserId as string);

    const {
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
    } = await getPaginatedAndFilterableAssets({
      // @TODO this is a good example where we dont need the teamMembers so we should modify the function to allow skipping it from query as it can be very heavy. This should be done for every case where we dont use teamMembers
      request,
      organizationId,
      filters: filtersSearchParams.toString(),
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const userPrefsCookie = await userPrefs.serialize(cookie);
    const headers = [setCookie(userPrefsCookie)];

    return json(
      data({
        search,
        totalItems: totalAssets,
        perPage,
        page,
        categories,
        tags,
        items: assets,
        totalPages,
        cookie,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        modelName,
      }),
      {
        headers,
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function UserAssetsPage() {
  return (
    <AssetsList
      disableTeamMemberFilter
      disableBulkActions
      customEmptyState={{
        title: "No assets in custody",
        text: "This user currently has no assets in their custody.",
      }}
    />
  );
}

export const handle = {
  name: "$userId.assets",
};
