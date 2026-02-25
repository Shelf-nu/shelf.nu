import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import { recordAuditScan } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const RecordScanSchema = z.object({
  auditSessionId: z.string(),
  qrId: z.string(),
  assetId: z.string(),
  isExpected: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .pipe(z.boolean()),
});

/**
 * API endpoint to persist an audit scan to the database.
 * This is called after an asset is scanned and resolved,
 * allowing audits to be resumed across sessions.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditSessionId, qrId, assetId, isExpected } = parseData(
      await request.formData(),
      RecordScanSchema,
      { additionalData: { userId } }
    );

    const result = await recordAuditScan({
      auditSessionId,
      qrId,
      assetId,
      isExpected,
      userId,
      organizationId,
    });

    return data(payload({ success: true, ...result }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
