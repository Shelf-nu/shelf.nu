import { AssetType, KitStatus } from "@prisma/client";
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { BulkAddToKitSchema } from "~/components/assets/bulk-add-to-kit-dialog";
import { db } from "~/database/db.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * This loader is used to get all the kits that can be bulk added to.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const kits = await db.kit.findMany({
      where: {
        organizationId,
        status: { not: KitStatus.CHECKED_OUT },
      },
      select: {
        id: true,
        name: true,
      },
    });

    return data(payload({ kits }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { assetIds, kit } = parseData(
      await request.formData(),
      BulkAddToKitSchema,
      {
        additionalData: { userId, organizationId },
      }
    );

    /**
     * Filter out QUANTITY_TRACKED assets — they require a per-asset slice
     * quantity that the bulk dialog has no UX to collect (the kit's own
     * manage-assets picker is the canonical place for that). The dialog
     * already shows a `WarningBox` listing how many will be skipped; here
     * we enforce the skip server-side and refuse the request when the
     * entire selection is qty-tracked. Mirror of `bulkUpdateAssetLocation`
     * (asset/service.server.ts).
     */
    const selectedAssets = await db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: { id: true, type: true },
    });
    const individualAssetIds = selectedAssets
      .filter((a) => a.type !== AssetType.QUANTITY_TRACKED)
      .map((a) => a.id);
    const skippedQuantityTracked =
      selectedAssets.length - individualAssetIds.length;

    if (individualAssetIds.length === 0 && skippedQuantityTracked > 0) {
      throw new ShelfError({
        cause: null,
        message:
          "All selected assets are quantity-tracked. Quantity-tracked assets must be added to a kit individually with a specific quantity from the kit's manage-assets page.",
        additionalData: { userId, organizationId, assetIds, kit },
        label: "Kit",
        shouldBeCaptured: false,
      });
    }

    const updatedKit = await updateKitAssets({
      kitId: kit,
      assetIds: individualAssetIds,
      organizationId,
      userId,
      request,
      addOnly: true, // Only add assets, don't remove existing ones
    });

    const skippedNote =
      skippedQuantityTracked > 0
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped — add them individually from the kit's manage-assets page.`
        : "";

    sendNotification({
      icon: { name: "success", variant: "success" },
      senderId: userId,
      title: "Bulk assets added to kit",
      message: `Successfully added ${individualAssetIds.length} assets to kit "${updatedKit.name}".${skippedNote}`,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
