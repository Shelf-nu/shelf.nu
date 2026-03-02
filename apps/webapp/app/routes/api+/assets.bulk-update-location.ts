import { data, type ActionFunctionArgs } from "react-router";
import { BulkLocationUpdateSchema } from "~/components/assets/bulk-location-update-dialog";
import { bulkUpdateAssetLocation } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const { assetIds, newLocationId, currentSearchParams } = parseData(
      formData,
      BulkLocationUpdateSchema.and(CurrentSearchParamsSchema)
    );

    await bulkUpdateAssetLocation({
      userId,
      assetIds,
      organizationId,
      newLocationId,
      currentSearchParams,
      settings,
    });

    sendNotification({
      title: "Assets updated",
      message: "Your assets' locations have been successfully updated",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
