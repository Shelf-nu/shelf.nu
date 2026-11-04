/**
 * Audit findings API
 *
 * GET `/api/audits/:auditId/findings?afterTitle=…&afterId=…` returns the page
 * of asset findings that follows the given cursor (the condition notes and
 * photos recorded against each asset). The overview loader sends the first
 * page; the list requests the following ones from here as it is scrolled,
 * passing the `nextCursor` of the page before.
 *
 * @see {@link file://./../../modules/audit/findings.server.ts} The read
 * @see {@link file://./../../components/audit/audit-findings.tsx} The consumer
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getAuditFindingsPage } from "~/modules/audit/findings.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, access } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
      additionalData: { userId },
    });

    // Both halves of the cursor are required: this endpoint only serves the
    // pages after the first, which the overview loader sends.
    const { afterTitle, afterId } = parseData(
      getCurrentSearchParams(request),
      z.object({
        afterTitle: z.string().max(1000),
        afterId: z.string().min(1),
      }),
      { additionalData: { userId, auditId } }
    );

    // `audit: read` authorizes reading audits in general, never THIS audit:
    // a member limited to assigned audits may only read the findings of an
    // audit they are assigned to. Tenancy is enforced by the read itself,
    // which filters on `organizationId`: another workspace's audit id reads
    // as an empty page.
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      assignedOnly: !access.audits.seeAll,
    });

    const findingsPage = await getAuditFindingsPage({
      auditSessionId: auditId,
      organizationId,
      after: { title: afterTitle, id: afterId },
    });

    return data(payload(findingsPage));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
