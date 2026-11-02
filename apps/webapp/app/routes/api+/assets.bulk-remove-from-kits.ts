import { data, type ActionFunctionArgs } from "react-router";
import { BulkRemoveFromKitsSchema } from "~/components/assets/bulk-remove-from-kits";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
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
    });

    // Fetch asset index settings to determine mode
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const { assetIds, currentSearchParams } = parseData(
      await request.formData(),
      BulkRemoveFromKitsSchema.and(CurrentSearchParamsSchema),
      {
        additionalData: { userId, organizationId },
      }
    );

    const { removedFromKitCount } = await bulkRemoveAssetsFromKits({
      assetIds,
      userId,
      organizationId,
      request,
      currentSearchParams,
      settings,
      lastAuditDateAccess: lastAuditDateAccessFor(access, currentOrganization),
      // Select-all acts on the assets the caller's list shows.
      bookableScope: resolveBookableListScope({ access, userId }),
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
