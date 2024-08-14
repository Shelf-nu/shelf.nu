import { json, type ActionFunctionArgs } from "@remix-run/node";
import { BulkReleaseCustodySchema } from "~/components/assets/bulk-release-custody-dialog";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.checkin,
    });

    const formData = await request.formData();

    const { assetIds, currentSearchParams } = parseData(
      formData,
      BulkReleaseCustodySchema.and(CurrentSearchParamsSchema)
    );

    await bulkCheckInAssets({
      userId,
      assetIds,
      organizationId,
      currentSearchParams,
    });

    sendNotification({
      title: "Assets are no longer in custody",
      message: "These assets are available again.",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
