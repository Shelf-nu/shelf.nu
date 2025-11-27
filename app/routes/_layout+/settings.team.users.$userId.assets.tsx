import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { AssetsList } from "~/components/assets/assets-index/assets-list";
import { getUserAssetsTabLoaderData } from "~/modules/asset/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Team member assets") }];

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

    const { headers, ...loaderData } = await getUserAssetsTabLoaderData({
      userId: selectedUserId,
      request,
      organizationId,
    });

    return data(payload(loaderData), { headers });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
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
