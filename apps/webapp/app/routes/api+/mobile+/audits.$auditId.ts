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
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { resolveMostPrivilegedRole } from "~/utils/booking-authorization.server";
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
    const { roles, canUseAudits } = await getMobileUserContext(
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

    // Gate the READ, not merely the CTA below. `isAssignee` was computed only
    // to decide whether to show a "Complete Audit" button, so an unassigned
    // BASE or SELF_SERVICE user could still fetch the full audit — its assets,
    // scans, notes and progress — for any audit in the workspace. The web
    // overview loader already gates this; mobile did not. (detail.dev D054)
    // Resolved from ALL roles, not from `role`. `getMobileUserContext` sets
    // `role = roles[0]`, and its own JSDoc warns that this is wrong for any
    // authorization decision: a membership ordered `[SELF_SERVICE, ADMIN]`
    // resolves to SELF_SERVICE, so a real admin who is not assigned to this
    // audit would be refused by the guard below.
    const effectiveRole = resolveMostPrivilegedRole(roles);
    const isSelfServiceOrBase =
      effectiveRole === "SELF_SERVICE" || effectiveRole === "BASE";
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase,
    });

    // Fetch session details and scans in parallel
    const [{ session, expectedAssets }, scans] = await Promise.all([
      getAuditSessionDetails({ id: auditId, organizationId }),
      getAuditScans({ auditSessionId: auditId, organizationId }),
    ]);

    // why: completing is assignee-gated server-side (requireAuditAssignee in
    // audits.complete.ts): ADMIN/OWNER may complete any audit, BASE and
    // SELF_SERVICE only when assigned. Encode that eligibility in
    // `canComplete` so the client never shows a "Complete Audit" CTA that
    // 403s after confirmation. Mirrors the endpoint's own rule exactly.
    const isAssignee = session.assignments.some((a) => a.user.id === user.id);
    const canCompleteAudit =
      (session.status === "ACTIVE" || session.status === "PENDING") &&
      (isAssignee || !isSelfServiceOrBase);

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
          displayName: session.createdBy?.displayName ?? null,
          profilePicture: session.createdBy?.profilePicture ?? null,
        },
        assignments: session.assignments.map((a) => ({
          userId: a.user.id,
          firstName: a.user.firstName ?? null,
          lastName: a.user.lastName ?? null,
          displayName: a.user.displayName,
          profilePicture: a.user.profilePicture,
          role: a.role,
        })),
      },
      expectedAssets: expectedAssets.map((a) => ({
        id: a.id,
        name: a.name,
        auditAssetId: a.auditAssetId,
        // Evidence can exist WITHOUT a scan: an auditor photographs an empty
        // shelf from the web scan screen, which attaches the note or photo to
        // the expected `AuditAsset` directly. Serving these only on the scan
        // shape below left those rows looking empty on the phone. The service
        // already counts them per expected asset, so this costs no query.
        auditNotesCount: a.auditNotesCount ?? 0,
        auditImagesCount: a.auditImagesCount ?? 0,
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
        id: s.id,
        code: s.code,
        assetId: s.assetId,
        assetTitle: s.assetTitle,
        isExpected: s.isExpected,
        scannedAt:
          s.scannedAt instanceof Date ? s.scannedAt.toISOString() : s.scannedAt,
        auditAssetId: s.auditAssetId,
        assetLocationName: s.assetLocationName,
        // why: lets the app say "deleted" instead of inferring it from an
        // empty title, which is also what a pre-snapshot row looks like.
        assetDeleted: s.assetDeleted,
        auditNotesCount: s.auditNotesCount,
        auditImagesCount: s.auditImagesCount,
      })),
      // why: same eligibility as record-scan's server-side gate, so the app
      // never offers a scanner whose submissions are guaranteed to 403
      canScan:
        (session.status === "PENDING" || session.status === "ACTIVE") &&
        (isAssignee || !isSelfServiceOrBase),
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
