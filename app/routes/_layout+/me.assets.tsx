import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import {
  getFiltersFromRequest,
  setCookie,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { AssetsList } from "./assets._index";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { filters, redirectNeeded } = await getFiltersFromRequest(
      request,
      organizationId
    );
    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/assets?${cookieParams.toString()}`);
    }

    const filtersSearchParams = new URLSearchParams();
    filtersSearchParams.set("userId", userId);

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

export default function MyAssets() {
  return (
    <AssetsList
      disableTeamMemberFilter
      disableBulkActions
      customEmptyState={{
        title: "No assets",
        text: "You have not created any assets yet and no assets are assigned to you.",
      }}
    />
  );
}
