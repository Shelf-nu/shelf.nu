import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { completeAuditSession } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";

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
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { sessionId, completionNote, timeZone } = z
      .object({
        sessionId: z.string().min(1),
        completionNote: z.string().optional(),
        timeZone: z.string().optional(),
      })
      .parse(body);

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
