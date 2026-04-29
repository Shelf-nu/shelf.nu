/**
 * @file Audit Bulk Actions API Route
 *
 * Handles bulk operations on audit sessions from the audits index page.
 * Currently supports:
 * - `bulk-archive` — Archive multiple COMPLETED/CANCELLED audits at once
 * - `bulk-delete` — Permanently delete multiple ARCHIVED audits at once
 *
 * @see {@link file://../../components/audit/bulk-archive-audits-dialog.tsx}
 * @see {@link file://../../components/audit/bulk-delete-audits-dialog.tsx}
 * @see {@link file://../../modules/audit/service.server.ts} - Service functions
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BulkArchiveAuditsSchema } from "~/components/audit/bulk-archive-audits-dialog";
import { BulkDeleteAuditsSchema } from "~/components/audit/bulk-delete-audits-dialog";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  bulkArchiveAudits,
  bulkDeleteAudits,
} from "~/modules/audit/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { intent, currentSearchParams } = parseData(
      formData,
      z
        .object({
          intent: z.enum(["bulk-archive", "bulk-delete"]),
        })
        .and(CurrentSearchParamsSchema)
    );

    const intentToActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-archive": PermissionAction.archive,
      "bulk-delete": PermissionAction.delete,
    };

    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-archive": {
        const { auditIds } = parseData(formData, BulkArchiveAuditsSchema);

        await bulkArchiveAudits({
          auditIds,
          organizationId,
          userId,
          currentSearchParams,
          isSelfServiceOrBase,
        });

        sendNotification({
          title: "Audits archived",
          message: "Your audits have been archived successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true }));
      }

      case "bulk-delete": {
        const { auditIds } = parseData(formData, BulkDeleteAuditsSchema);

        const { count } = await bulkDeleteAudits({
          auditIds,
          organizationId,
          userId,
          currentSearchParams,
        });

        const isSingle = count === 1;
        sendNotification({
          title: isSingle ? "Audit deleted" : "Audits deleted",
          message: `Permanently deleted ${count} ${
            isSingle ? "audit" : "audits"
          }.`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return data(payload({ success: true, count }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return data(payload(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
