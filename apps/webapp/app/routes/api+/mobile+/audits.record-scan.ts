import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  recordAuditScan,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/record-scan
 *
 * Records a single asset scan during an audit session.
 * If the asset was already scanned, returns the existing scan data
 * without creating a duplicate.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * Body:
 *   - auditSessionId: string — the audit session being scanned
 *   - qrId: string — the QR code or barcode value that was scanned
 *   - assetId: string — the resolved asset ID
 *   - isExpected: boolean (optional, ignored) — accepted so shipped builds keep
 *     working; the server derives expectedness from the audit's own rows
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { canUseAudits, role } = await getMobileUserContext(
      user.id,
      organizationId
    );
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

    const body = await request.json();
    const { auditSessionId, qrId, assetId } = z
      .object({
        auditSessionId: z.string().min(1),
        qrId: z.string().min(1),
        assetId: z.string().min(1),
        // Accepted for wire compatibility with shipped app builds, but never
        // forwarded: `recordAuditScan` derives expectedness from the audit's
        // own AuditAsset row. A device queues scans offline, so its cached
        // expected list can be hours out of date by the time they land.
        isExpected: z.boolean().optional(),
      })
      .parse(body);

    // Scanning writes audit data, so it is gated exactly like note, photo and
    // complete: ADMIN/OWNER act on any audit, BASE/SELF_SERVICE must be
    // assignees. Without this gate a scan is recorded (and can start the
    // audit) for users whose evidence uploads are then rejected.
    await requireAuditAssignee({
      auditSessionId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase: role === "SELF_SERVICE" || role === "BASE",
    });

    const { scanId, auditAssetId, foundAssetCount, unexpectedAssetCount } =
      await recordAuditScan({
        auditSessionId,
        qrId,
        assetId,
        userId: user.id,
        organizationId,
      });

    return data({
      success: true,
      scanId,
      auditAssetId,
      foundAssetCount,
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
