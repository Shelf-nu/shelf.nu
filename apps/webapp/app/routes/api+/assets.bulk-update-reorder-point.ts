/**
 * Bulk set reorder point.
 *
 * Writes `Asset.minQuantity` across a selection, or clears it. Mirrors the
 * other bulk-update endpoints: POST only, `asset: update` permission, and the
 * select-all path resolved from the live search params through the shared
 * helper so "select all" honours the filters currently on screen.
 *
 * @see {@link file://../../components/assets/bulk-set-reorder-point-dialog.tsx}
 * @see {@link file://../../modules/asset/service.server.ts} - `bulkUpdateAssetMinQuantity`
 */

import { data, type ActionFunctionArgs } from "react-router";
import { BulkSetReorderPointSchema } from "~/components/assets/bulk-set-reorder-point-dialog";
import { bulkUpdateAssetMinQuantity } from "~/modules/asset/service.server";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
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

    // Needed to resolve "select all" in advanced mode, where the affected set
    // comes from the saved column/filter settings rather than an id list.
    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    const { assetIds, minQuantity, currentSearchParams } = parseData(
      formData,
      BulkSetReorderPointSchema.and(CurrentSearchParamsSchema)
    );

    // Acting user's timezone: with "select all" active the affected set is
    // resolved from the current date filters, which must truncate the day in
    // the user's tz (avoids an off-by-one for non-UTC users).
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const changedCount = await bulkUpdateAssetMinQuantity({
      userId,
      assetIds,
      organizationId,
      minQuantity,
      currentSearchParams,
      settings,
      timeZone,
    });

    // Report what actually happened, not what was attempted. A selection can be
    // entirely individually-tracked assets (skipped, they have no pool), or
    // already hold this threshold, and telling someone it was set when nothing
    // moved is exactly the kind of small lie that costs trust in a bulk action.
    const noun = changedCount === 1 ? "asset" : "assets";
    sendNotification(
      changedCount === 0
        ? {
            title: "Nothing to change",
            message:
              "None of the selected assets needed updating. Individually-tracked assets are skipped, and any already using this reorder point were left alone.",
            icon: { name: "success", variant: "success" },
            senderId: userId,
          }
        : {
            title:
              minQuantity === null
                ? "Reorder point cleared"
                : "Reorder point set",
            message:
              minQuantity === null
                ? `Cleared on ${changedCount} ${noun}. Stock status will stop judging their level.`
                : `Set on ${changedCount} ${noun}. Stock status will flag them once available units fall to ${minQuantity} or below.`,
            icon: { name: "success", variant: "success" },
            senderId: userId,
          }
    );

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
