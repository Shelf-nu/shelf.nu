/**
 * Bulk Asset Model Update API
 *
 * Links (or unlinks) every selected asset to a single AssetModel. Backs the
 * "Update asset model" item in the asset index Actions menu.
 *
 * The reported counts are deliberately specific: a select-all can resolve to
 * a different set than the one on screen, and quantity-tracked assets are
 * skipped, so a flat "Assets updated" toast would hide both.
 *
 * @see {@link file://./../../components/assets/bulk-asset-model-update-dialog.tsx} assign dialog
 * @see {@link file://./../../components/assets/bulk-asset-model-remove-dialog.tsx} remove dialog
 * @see {@link file://./../../modules/asset/service.server.ts} `bulkUpdateAssetModel`
 */
import { data, type ActionFunctionArgs } from "react-router";
import { BulkAssetModelActionSchema } from "~/components/assets/bulk-asset-model-update-dialog";
import { bulkUpdateAssetModel } from "~/modules/asset/service.server";
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

    const { assetIds, assetModelId, currentSearchParams } = parseData(
      formData,
      BulkAssetModelActionSchema.and(CurrentSearchParamsSchema)
    );

    const {
      linked,
      resolved,
      updated,
      moved,
      skippedQuantityTracked,
      modelName,
    } = await bulkUpdateAssetModel({
      userId,
      assetIds,
      assetModelId,
      organizationId,
      currentSearchParams,
      settings,
    });

    /**
     * Appended when linking, never when unlinking: the service already zeroes
     * the count on the unlink path, where a quantity-tracked asset was never
     * going to change.
     */
    const skippedSuffix =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped.`
        : "";

    /**
     * A zero-row result is a real outcome, not a success. Saying "updated"
     * here would train users to trust a no-op, and a select-all can resolve
     * to a narrower set than the screen shows. The three causes read very
     * differently to the user, so they get their own sentences.
     */
    if (updated === 0) {
      const reason =
        resolved === 0
          ? "Your filters no longer match any assets."
          : linked
          ? "The selected assets are already in this asset model."
          : "None of the selected assets were in an asset model.";

      sendNotification({
        title: "No assets updated",
        message: `${reason}${skippedSuffix}`,
        icon: { name: "asset-model", variant: "gray" },
        senderId: userId,
      });

      return data(payload({ success: true }));
    }

    if (linked) {
      /**
       * `moved` is the only warning that another model's book-by-model
       * availability pool just shrank, so it is stated rather than folded
       * into the total.
       */
      const movedSuffix =
        moved > 0
          ? ` ${moved} of them were moved from another asset model.`
          : "";

      // Branch on `linked`, never on `modelName`: the name is only a label.
      sendNotification({
        title: "Assets grouped",
        message: `${updated} asset(s) were grouped into ${
          modelName || "the selected asset model"
        }.${movedSuffix}${skippedSuffix}`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });

      return data(payload({ success: true }));
    }

    sendNotification({
      title: "Assets updated",
      message: `${updated} asset(s) were removed from their asset model.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
