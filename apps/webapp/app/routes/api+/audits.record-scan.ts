import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

import {
  recordAuditScan,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
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
  // Accepted for wire compatibility with clients that still send it, but never
  // forwarded: `recordAuditScan` derives expectedness from the audit's own
  // AuditAsset row, because a client's cached expected list goes stale.
  isExpected: z.string().optional(),
});

/**
 * API endpoint to persist an audit scan to the database.
 * This is called after an asset is scanned and resolved,
 * allowing audits to be resumed across sessions.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditSessionId, qrId, assetId } = parseData(
      await request.formData(),
      RecordScanSchema,
      { additionalData: { userId } }
    );

    // Scanning writes audit data, so it is gated exactly like note, photo and
    // complete: ADMIN/OWNER act on any audit, BASE/SELF_SERVICE must be
    // assignees. `audit: update` alone is not enough — BASE and SELF_SERVICE
    // both hold it, so without this gate any member could record a scan on any
    // audit in the workspace and win its permanent first-start claim, stamping
    // the wrong actor and time on an AUDIT_STARTED that is never rewritten.
    // Mirrors the mobile sibling at api+/mobile+/audits.record-scan.ts.
    await requireAuditAssignee({
      auditSessionId,
      organizationId,
      userId,
      isSelfServiceOrBase,
    });

    const result = await recordAuditScan({
      auditSessionId,
      qrId,
      assetId,
      userId,
      organizationId,
    });

    return data(payload({ success: true, ...result }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
