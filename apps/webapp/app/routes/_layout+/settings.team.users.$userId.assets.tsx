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
    const { organizationId, canSeeAllCustody } = await requirePermission({
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
      // The SUBJECT is the profile being viewed; the VIEWER is the caller.
      // Passing `selectedUserId` as the viewer would make the custody
      // narrowing treat the requested custodian as the principal — any caller
      // could then list any user's custody.
      userId: selectedUserId,
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

export default function UserAssetsPage() {
  return (
    <AssetsList
      disableTeamMemberFilter
      disableBulkActions
      customEmptyStateContent={{
        title: "No assets in custody",
        text: "This user currently has no assets in their custody.",
      }}
    />
  );
}

export const handle = {
  name: "$userId.assets",
};
