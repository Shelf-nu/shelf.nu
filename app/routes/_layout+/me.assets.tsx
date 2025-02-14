import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getAssetsTabLoaderData } from "~/modules/asset/service.server";
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

    const { headers, ...loaderData } = await getAssetsTabLoaderData({
      userId,
      request,
      organizationId,
    });

    return json(data(loaderData), { headers });
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
