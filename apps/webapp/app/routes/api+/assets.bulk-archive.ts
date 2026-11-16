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
import { bulkArchiveResultMessage } from "~/modules/asset/archive-messages";
import {
  CONFIRM_MODEL_SHORTFALL_FIELD,
  isModelShortfallMessage,
} from "~/modules/asset/archive-shortfall";
import { lastAuditDateAccessFor } from "~/modules/asset/last-audit-date-access.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import {
  bulkArchiveAssets,
  bulkUnarchiveAssets,
} from "~/modules/asset/service.server";
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
      action: PermissionAction.archive,
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

    // Acting user's timezone: when "select all" is active the affected set is
    // resolved from the current date filters, which must truncate the day in
    // the user's tz (avoids an off-by-one for non-UTC users).
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    if (type === "archive") {
      const { archivedCount, skippedCount, draftBookings } =
        await bulkArchiveAssets({
          organizationId,
          assetIds,
          currentSearchParams,
          settings,
          lastAuditDateAccess: lastAuditDateAccessFor(
            access,
            currentOrganization
          ),
          bookableScope: resolveBookableListScope({ access, userId }),
          actorUserId: userId,
          timeZone,
          // Set by the dialog's "Archive anyway" after the shortfall warning.
          confirmModelShortfall:
            formData.get(CONFIRM_MODEL_SHORTFALL_FIELD) === "true",
        });

      const result = bulkArchiveResultMessage({
        action: "archive",
        changed: archivedCount,
        skipped: skippedCount,
        draftBookings,
      });
      sendNotification({
        title: result.title,
        message: result.message,
        icon: result.success
          ? { name: "success", variant: "success" }
          : { name: "archive", variant: "gray" },
        senderId: userId,
      });
    } else {
      const { unarchivedCount, skippedCount } = await bulkUnarchiveAssets({
        organizationId,
        assetIds,
        currentSearchParams,
        settings,
        lastAuditDateAccess: lastAuditDateAccessFor(
          access,
          currentOrganization
        ),
        bookableScope: resolveBookableListScope({ access, userId }),
        actorUserId: userId,
        timeZone,
      });

      const result = bulkArchiveResultMessage({
        action: "reinstate",
        changed: unarchivedCount,
        skipped: skippedCount,
      });
      sendNotification({
        title: result.title,
        message: result.message,
        icon: result.success
          ? { name: "success", variant: "success" }
          : { name: "reinstate", variant: "gray" },
        senderId: userId,
      });
    }

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // The model-reservation warning is a question, not a failure: the dialog
    // shows it with "Archive anyway", so no error toast.
    const isShortfallWarning = isModelShortfallMessage(reason.message);
    return data(error(reason, !isShortfallWarning), { status: reason.status });
  }
}
