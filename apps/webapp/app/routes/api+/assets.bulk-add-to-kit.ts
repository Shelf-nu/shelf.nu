import { AssetType, KitStatus } from "@prisma/client";
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { BulkAddToKitSchema } from "~/components/assets/bulk-add-to-kit-dialog";
import { db } from "~/database/db.server";
import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
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
      // Bulk edits other than location stay closed to the workspace switches.
      matrixOnly: true,
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

    const {
      organizationId,
      canUseBarcodes,
      role,
      access,
      currentOrganization,
    } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
      // Bulk edits other than location stay closed to the workspace switches.
      matrixOnly: true,
    });

    const {
      assetIds: selectedIds,
      kit,
      currentSearchParams,
    } = parseData(
      await request.formData(),
      BulkAddToKitSchema.and(CurrentSearchParamsSchema),
      {
        additionalData: { userId, organizationId },
      }
    );

    // "Select all" posts the loaded rows plus a marker, and means every asset
    // the list's filters match. The resolver expands it from the submitted
    // search params; hand-picked ids come back unchanged.
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });
    // Acting user's timezone: the select-all set is resolved from the current
    // date filters, which must truncate the day in the user's tz.
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );
    const assetIds = await resolveAssetIdsForBulkOperation({
      assetIds: selectedIds,
      organizationId,
      currentSearchParams,
      settings,
      timeZone,
      // Reachable only with an asset write permission, which BASE and
      // SELF_SERVICE do not hold, so the custodian filter needs no narrowing.
      allowedTeamMemberIds: "all",
      custodySearchScope: "all",
      lastAuditDateAccess: lastAuditDateAccessFor(access, currentOrganization),
      bookableScope: resolveBookableListScope({ access, userId }),
    });

    /**
     * Filter out QUANTITY_TRACKED assets — they require a per-asset slice
     * quantity that the bulk dialog has no UX to collect (the kit's own
     * manage-assets picker is the canonical place for that). The dialog warns
     * that they will be skipped; here the skip is enforced server-side, and
     * the request is refused when the entire selection is qty-tracked. Mirror
     * of `bulkUpdateAssetLocation` (asset/service.server.ts).
     */
    const selectedAssets = await db.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: type split only; archived ids must reach updateKitAssets so its archive guard refuses them instead of silently dropping them here
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
        // Explicit: with no status and no cause this would answer 500 for a
        // selection the user can simply change.
        status: 400,
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
        ? ` ${skippedQuantityTracked} quantity-tracked asset(s) were skipped. Add them individually from the kit's manage-assets page.`
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
