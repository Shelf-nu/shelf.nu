import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { getUserAssetsTabLoaderData } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Handle is used for properly displaying columns in AssetsList
 */
export const handle = {
  name: "me.assets",
};

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

    const { headers, ...loaderData } = await getUserAssetsTabLoaderData({
      userId,
      request,
      organizationId,
    });

    return json(payload(loaderData), { headers });
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
