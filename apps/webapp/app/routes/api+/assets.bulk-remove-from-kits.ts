import { data, type ActionFunctionArgs } from "react-router";
import { BulkRemoveFromKitsSchema } from "~/components/assets/bulk-remove-from-kits";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { bulkRemoveAssetsFromKits } from "~/modules/kit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      request,
      userId,
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

    const { assetIds } = parseData(
      await request.formData(),
      BulkRemoveFromKitsSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    const { removedFromKitCount } = await bulkRemoveAssetsFromKits({
      assetIds,
      userId,
      organizationId,
      request,
      settings,
    });

    sendNotification({
      icon: { name: "success", variant: "success" },
      senderId: userId,
      title: "Bulk assets removed from kits",
      // What was actually detached. `assetIds` is what was ASKED for: it
      // counts assets that turned out not to be in a kit, and under
      // select-all it is the single `ALL_SELECTED_KEY` sentinel, so it would
      // report "1 assets" however many were removed.
      message: `Successfully removed ${removedFromKitCount} ${
        removedFromKitCount === 1 ? "asset" : "assets"
      } from kits.`,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
