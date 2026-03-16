import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { recordAuditScan } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";

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
 *   - isExpected: boolean — whether the asset was expected in the audit
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { auditSessionId, qrId, assetId, isExpected } = z
      .object({
        auditSessionId: z.string().min(1),
        qrId: z.string().min(1),
        assetId: z.string().min(1),
        isExpected: z.boolean(),
      })
      .parse(body);

    const { scanId, auditAssetId, foundAssetCount, unexpectedAssetCount } =
      await recordAuditScan({
        auditSessionId,
        qrId,
        assetId,
        isExpected,
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
