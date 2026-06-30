/**
 * POST /api/assets/bulk-archive
 *
 * Bulk-archives or reinstates the selected assets (issue #382). Mirrors the
 * bulk mark-availability route: resolves the selection (including "select all"
 * via the index settings), then delegates to bulkArchiveAssets /
 * bulkUnarchiveAssets, which skip ineligible rows and report the counts.
 *
 * @see {@link file://./../../components/assets/bulk-archive-dialog.tsx}
 * @see {@link file://./../../modules/asset/service.server.ts} (bulkArchiveAssets)
 */

import { data, type ActionFunctionArgs } from "react-router";
import { BulkArchiveSchema } from "~/components/assets/bulk-archive-dialog";
import {
  bulkArchiveAssets,
  bulkUnarchiveAssets,
} from "~/modules/asset/service.server";
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

    const { organizationId, canUseBarcodes, role } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.asset,
      // Asset has no dedicated `archive` PermissionAction (it is granted only to
      // bookings/audits); archiving is a state mutation, so gate it on `update`.
      action: PermissionAction.update,
    });

    // Fetch asset index settings to resolve "select all" in the right mode.
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const formData = await request.formData();

    const { assetIds, type, currentSearchParams } = parseData(
      formData,
      BulkArchiveSchema.and(CurrentSearchParamsSchema)
    );

    if (type === "archive") {
      const { archivedCount, skippedCount } = await bulkArchiveAssets({
        organizationId,
        assetIds,
        currentSearchParams,
        settings,
        actorUserId: userId,
      });

      sendNotification({
        title: "Assets archived",
        message:
          skippedCount > 0
            ? `${archivedCount} archived, ${skippedCount} skipped (checked out, in custody, quantity-tracked, or already archived).`
            : `${archivedCount} ${
                archivedCount === 1 ? "asset" : "assets"
              } archived.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    } else {
      const { unarchivedCount, skippedCount } = await bulkUnarchiveAssets({
        organizationId,
        assetIds,
        currentSearchParams,
        settings,
        actorUserId: userId,
      });

      sendNotification({
        title: "Assets reinstated",
        message:
          skippedCount > 0
            ? `${unarchivedCount} reinstated, ${skippedCount} skipped (not archived).`
            : `${unarchivedCount} ${
                unarchivedCount === 1 ? "asset" : "assets"
              } reinstated.`,
        icon: { name: "success", variant: "success" },
        senderId: userId,
      });
    }

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
