import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkLocationUpdateSchema } from "~/components/assets/bulk-location-update-dialog";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import { bulkUpdateAssetLocation } from "~/modules/asset/service.server";
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

    const {
      organizationId,
      canUseBarcodes,
      role,
      access,
      currentOrganization,
    } = await requirePermission({
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

    const { assetIds, newLocationId, currentSearchParams, quantityTracked } =
      parseData(
        formData,
        BulkLocationUpdateSchema.and(CurrentSearchParamsSchema).and(
          z.object({
            // Sent by a caller that submits an explicit list and reports one
            // result for it (the scanner drawer): a quantity-tracked asset,
            // which this path cannot place, then refuses the list. Left out
            // by the asset index dialog, which warns about those assets
            // before the user confirms and relies on them being skipped.
            quantityTracked: z.enum(["skip", "refuse"]).optional(),
          })
        )
      );

    // Acting user's timezone: when "select all" is active the affected set is
    // resolved from the current date filters, which must truncate the day in
    // the user's tz (avoids an off-by-one for non-UTC users).
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const { skippedQuantityTracked } = await bulkUpdateAssetLocation({
      userId,
      assetIds,
      organizationId,
      newLocationId,
      currentSearchParams,
      settings,
      lastAuditDateAccess: lastAuditDateAccessFor(access, currentOrganization),
      bookableScope: resolveBookableListScope({ access, userId }),
      timeZone,
      quantityTracked,
    });

    // The dialog can only count the quantity-tracked rows it has loaded, and
    // "select all" reaches rows on other pages, so the real number of skipped
    // assets is reported here.
    const skippedNote =
      skippedQuantityTracked > 0
        ? `. ${skippedQuantityTracked} quantity-tracked asset(s) were skipped. Set their placements, with a quantity per location, on each asset's page.`
        : "";

    sendNotification({
      title: "Assets updated",
      message: `Your assets' locations have been successfully updated${skippedNote}`,
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
