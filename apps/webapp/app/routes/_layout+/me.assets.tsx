import { data, type LoaderFunctionArgs } from "react-router";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { getUserAssetsTabLoaderData } from "~/modules/asset/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
export const meta = () => [{ title: appendToMetaTitle("My assets") }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId, canSeeAllCustody } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const { headers, ...loaderData } = await getUserAssetsTabLoaderData({
      // Viewer and subject are the same person on this route — but they are
      // still passed separately, because the helper narrows the custodian
      // filter it injects against `viewerId`.
      userId,
      viewerId: userId,
      canSeeAllCustody,
      request,
      organizationId,
    });

    return data(payload(loaderData), { headers });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function MyAssets() {
  return (
    <AssetsList
      disableTeamMemberFilter
      disableBulkActions
      customEmptyStateContent={{
        title: "No assets",
        text: "You have not created any assets yet and no assets are assigned to you.",
      }}
    />
  );
}
