import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  requireMobileAuditsEnabled,
} from "~/modules/api/mobile-auth.server";
import {
  completeAuditSession,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/audits/complete
 *
 * Completes an active audit session. Marks all unscanned expected assets
 * as MISSING and transitions the session to COMPLETED status.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * Body:
 *   - sessionId: string — the audit session to complete
 *   - completionNote (optional): string — a note to attach to the completion
 *   - timeZone (optional): string — client timezone for formatting (defaults to UTC)
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobileAuditsEnabled(organizationId);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase = role === "SELF_SERVICE" || role === "BASE";

    const body = await request.json();
    const { sessionId, completionNote, timeZone } = z
      .object({
        sessionId: z.string().min(1),
        completionNote: z.string().optional(),
        timeZone: z.string().optional(),
      })
      .parse(body);

    // Only assignees can complete the audit (matches webapp behavior).
    // Exception: admins/owners can complete if audit has no assignees.
    await requireAuditAssignee({
      auditSessionId: sessionId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase,
    });

    const hints = {
      timeZone: timeZone || "UTC",
      locale: "en-US",
    };

    await completeAuditSession({
      sessionId,
      organizationId,
      userId: user.id,
      completionNote,
      hints,
    });

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
