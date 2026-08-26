import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  removeAuditScan,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { resolveMostPrivilegedRole } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/remove-scan
 *
 * Removes a recorded scan from a live audit — the undo for a mis-scan. The
 * mobile twin of the web scan page's remove action: both delegate to
 * `removeAuditScan`, so an expected asset returns to "not scanned", an
 * unexpected one disappears from the audit, and the session's counts are
 * recomputed in the same transaction.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * Body:
 *   - auditSessionId: string — the audit session the scan belongs to
 *   - assetId: string — the asset whose scan is being removed
 *
 * Gated exactly like record-scan: audits enabled for the workspace, `audit:
 * update` permission, and ADMIN/OWNER act on any audit while BASE/SELF_SERVICE
 * must be assignees.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { canUseAudits, roles } = await getMobileUserContext(
      user.id,
      organizationId
    );
    // A membership can carry several roles in any order; gate on the most
    // privileged one, or an actual admin ordered [SELF_SERVICE, ADMIN] would
    // be treated as restricted.
    const role = resolveMostPrivilegedRole(roles);
    if (!canUseAudits) {
      return data(
        {
          error: {
            message:
              "Audits are not enabled for this workspace. Contact your admin to enable this feature.",
          },
        },
        { status: 403 }
      );
    }

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { auditSessionId, assetId } = await parseMobileBody(
      z.object({
        auditSessionId: z.string().min(1),
        assetId: z.string().min(1),
      }),
      request,
      "Audit"
    );

    // Removing a scan rewrites audit data, so it carries the same gate as
    // recording one: without it a non-assignee could hollow out an audit
    // they are not part of.
    await requireAuditAssignee({
      auditSessionId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase: role === "SELF_SERVICE" || role === "BASE",
    });

    const {
      removed,
      foundAssetCount,
      missingAssetCount,
      unexpectedAssetCount,
    } = await removeAuditScan({
      auditSessionId,
      assetId,
      userId: user.id,
      organizationId,
    });

    return data({
      success: true,
      removed,
      foundAssetCount,
      missingAssetCount,
      unexpectedAssetCount,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
