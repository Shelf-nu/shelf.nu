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
  recordAuditScan,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
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
 *   - isExpected: boolean (optional, ignored): accepted so shipped builds keep
 *     working; the server derives expectedness from the audit's own rows
 *   - foundQuantity: integer (optional): units counted, for a quantity-tracked
 *     asset. A second scan of the same asset with a count replaces the count.
 *
 * A quantity-tracked scan sent WITHOUT `foundQuantity` comes from a build that
 * has no count prompt. It is recorded as Found and not counted, because such a
 * build queues scans offline and a refused scan would block its audit from
 * completing. Builds with the prompt always send the count.
 *
 * Response: `{ success, scanId, auditAssetId, foundAssetCount,
 * unexpectedAssetCount, expectedQuantity, foundQuantity }`.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { canUseAudits, access } = await getMobileUserContext(
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

    const { auditSessionId, qrId, assetId, foundQuantity } =
      await parseMobileBody(
        z.object({
          auditSessionId: z.string().min(1),
          qrId: z.string().min(1),
          assetId: z.string().min(1),
          // Accepted for wire compatibility with shipped app builds, but never
          // forwarded: `recordAuditScan` derives expectedness from the audit's
          // own AuditAsset row. A device queues scans offline, so its cached
          // expected list can be hours out of date by the time they land.
          isExpected: z.boolean().optional(),
          // Bounds are re-checked by the service; zero is a real count.
          foundQuantity: z.number().int().nonnegative().optional(),
        }),
        request,
        "Audit"
      );

    // Scanning writes audit data, so it is gated exactly like note, photo and
    // complete: callers who see every audit act on any audit, everyone else
    // must be an assignee. Without this gate a scan is recorded (and can start the
    // audit) for users whose evidence uploads are then rejected.
    await requireAuditAssignee({
      auditSessionId,
      organizationId,
      userId: user.id,
      assignedOnly: !access.audits.seeAll,
    });

    const result = await recordAuditScan({
      auditSessionId,
      qrId,
      assetId,
      userId: user.id,
      organizationId,
      userAgent: request.headers.get("user-agent"),
      foundQuantity,
      acceptUncounted: foundQuantity === undefined,
    });

    // `acceptUncounted` is set whenever no count is sent, so the service
    // always records here.
    if (result.status !== "recorded") {
      throw new ShelfError({
        cause: null,
        message: "This scan needs a count.",
        additionalData: { auditSessionId, assetId },
        status: 400,
        shouldBeCaptured: false,
        label: "Audit",
      });
    }

    return data({
      success: true,
      scanId: result.scanId,
      auditAssetId: result.auditAssetId,
      foundAssetCount: result.foundAssetCount,
      unexpectedAssetCount: result.unexpectedAssetCount,
      expectedQuantity: result.expectedQuantity,
      foundQuantity: result.foundQuantity,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
