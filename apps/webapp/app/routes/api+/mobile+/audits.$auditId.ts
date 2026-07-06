import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  getAuditSessionDetails,
  getAuditScans,
} from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/audits/:auditId
 *
 * Returns full audit session detail including assignments, expected assets,
 * and existing scans. Also includes capability flags for the mobile client.
 *
 * Query params:
 *   - orgId (required): organization ID
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { role, canUseAudits } = await getMobileUserContext(
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

    const { auditId } = getParams(
      params,
      z.object({ auditId: z.string().min(1) })
    );

    // Fetch session details and scans in parallel
    const [{ session, expectedAssets }, scans] = await Promise.all([
      getAuditSessionDetails({ id: auditId, organizationId }),
      getAuditScans({ auditSessionId: auditId, organizationId }),
    ]);

    // why: completing is assignee-gated server-side (requireAuditAssignee in
    // audits.complete.ts): only an assignee may complete, except admins/owners
    // may complete an audit that has no assignees. Encode that eligibility in
    // `canComplete` so the client never shows a "Complete Audit" CTA that
    // 403s after confirmation — e.g. an admin viewing another user's audit in
    // the all-workspace list. Mirrors the endpoint's own rule exactly.
    const isSelfServiceOrBase = role === "SELF_SERVICE" || role === "BASE";
    const hasNoAssignees = session.assignments.length === 0;
    const isAssignee = session.assignments.some((a) => a.user.id === user.id);
    const canCompleteAudit =
      (session.status === "ACTIVE" || session.status === "PENDING") &&
      (isAssignee || (!isSelfServiceOrBase && hasNoAssignees));

    return data({
      audit: {
        id: session.id,
        name: session.name,
        description: session.description,
        status: session.status,
        expectedAssetCount: session.expectedAssetCount,
        foundAssetCount: session.foundAssetCount,
        missingAssetCount: session.missingAssetCount,
        unexpectedAssetCount: session.unexpectedAssetCount,
        dueDate: session.dueDate?.toISOString() ?? null,
        startedAt: session.startedAt?.toISOString() ?? null,
        completedAt: session.completedAt?.toISOString() ?? null,
        createdAt: session.createdAt.toISOString(),
        createdBy: {
          firstName: session.createdBy?.firstName ?? null,
          lastName: session.createdBy?.lastName ?? null,
          profilePicture: session.createdBy?.profilePicture ?? null,
        },
        assignments: session.assignments.map((a) => ({
          userId: a.user.id,
          firstName: a.user.firstName,
          lastName: a.user.lastName,
          profilePicture: a.user.profilePicture,
          role: a.role,
        })),
      },
      expectedAssets: expectedAssets.map((a) => ({
        id: a.id,
        name: a.name,
        auditAssetId: a.auditAssetId,
        mainImage: a.mainImage ?? null,
        thumbnailImage: a.thumbnailImage ?? null,
        // why: surface where the asset should be, what category it
        // belongs to, and who currently has it so the field worker can
        // resolve the audit row without leaving the audit context. All
        // nullable: location/category may be unset, custody is sparse.
        locationName: a.locationName ?? null,
        categoryName: a.categoryName ?? null,
        custodianName: a.custodianName ?? null,
      })),
      existingScans: scans.map((s) => ({
        code: s.code,
        assetId: s.assetId,
        assetTitle: s.assetTitle,
        isExpected: s.isExpected,
        scannedAt:
          s.scannedAt instanceof Date ? s.scannedAt.toISOString() : s.scannedAt,
        auditAssetId: s.auditAssetId,
        assetLocationName: s.assetLocationName,
        auditNotesCount: s.auditNotesCount,
        auditImagesCount: s.auditImagesCount,
      })),
      canScan: session.status === "PENDING" || session.status === "ACTIVE",
      canComplete: canCompleteAudit,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
