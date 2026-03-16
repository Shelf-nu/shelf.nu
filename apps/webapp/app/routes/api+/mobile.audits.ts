import { AuditStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getAuditsForOrganization } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/audits
 *
 * Returns paginated audits for the user's organization.
 * Query params:
 *   - orgId (required): organization ID
 *   - status (optional): filter by a single AuditStatus (e.g., PENDING, ACTIVE, COMPLETED)
 *   - page (optional): page number (default 1)
 *   - perPage (optional): items per page (default 20, max 50)
 *   - search (optional): search string
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const searchParam = url.searchParams.get("search");
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "20", 10) || 20)
    );

    // Validate status filter — only pass a single valid AuditStatus.
    // If the client sends multiple comma-separated values, ignore and show all.
    const validStatuses = Object.values(AuditStatus);
    let statusFilter: AuditStatus | null = null;
    if (statusParam) {
      const trimmed = statusParam.trim();
      if (
        !trimmed.includes(",") &&
        validStatuses.includes(trimmed as AuditStatus)
      ) {
        statusFilter = trimmed as AuditStatus;
      }
    }

    const { audits, totalAudits } = await getAuditsForOrganization({
      organizationId,
      page,
      perPage,
      search: searchParam || null,
      status: statusFilter,
    });

    return data({
      audits: audits.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        expectedAssetCount: a.expectedAssetCount,
        foundAssetCount: a.foundAssetCount,
        missingAssetCount: a.missingAssetCount,
        unexpectedAssetCount: a.unexpectedAssetCount,
        dueDate: a.dueDate?.toISOString() ?? null,
        startedAt: a.startedAt?.toISOString() ?? null,
        completedAt: a.completedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        createdBy: {
          firstName: a.createdBy?.firstName ?? null,
          lastName: a.createdBy?.lastName ?? null,
        },
        assigneeCount: a._count?.assignments ?? 0,
      })),
      page,
      perPage,
      totalCount: totalAudits,
      totalPages: Math.ceil(totalAudits / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
