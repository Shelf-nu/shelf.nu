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
 *   - status (optional): comma-separated AuditStatus values
 *     e.g. "PENDING,ACTIVE" or "COMPLETED"
 *   - page (optional): page number (default 1)
 *   - perPage (optional): items per page (default 20, max 50)
 *   - search (optional): search string
 *   - assignedToMe (optional): "true" → restrict to audits the caller is
 *     assigned to. Admins/owners normally see every org audit; this lets
 *     them opt into "just my work" via the companion's filter chip.
 *     For BASE/SELF_SERVICE users the filter is already implicit in the
 *     service layer; passing the flag is a no-op for them.
 *
 * Mobile-only sort: results are always ordered by `dueDate asc nulls last,
 * createdAt desc` so the companion list surfaces overdue + soon-due work
 * first. The webapp uses its own column-sort UI and does not hit this
 * endpoint.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const searchParam = url.searchParams.get("search");
    const assignedToMe = url.searchParams.get("assignedToMe") === "true";
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "20", 10) || 20)
    );

    // Parse and validate status filters
    const validStatuses = Object.values(AuditStatus);
    const statusFilters: AuditStatus[] = statusParam
      ? statusParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is AuditStatus =>
            validStatuses.includes(s as AuditStatus)
          )
      : [];

    // Single status → pass directly to service (uses DB-level filter)
    // No status or all statuses → pass null (get everything)
    // Multiple statuses → fetch all, filter in JS (service only accepts single)
    const isSingleStatus = statusFilters.length === 1;
    const isAllOrNone =
      statusFilters.length === 0 ||
      statusFilters.length >= validStatuses.length;

    const { audits: rawAudits, totalAudits: rawTotal } =
      await getAuditsForOrganization({
        organizationId,
        page: isSingleStatus || isAllOrNone ? page : 1,
        perPage: isSingleStatus || isAllOrNone ? perPage : 200,
        search: searchParam || null,
        status: isSingleStatus ? statusFilters[0] : null,
        assignedToUserId: assignedToMe ? user.id : null,
        prioritizeDeadlines: true,
      });

    // Post-filter for multi-status queries (e.g. "PENDING,ACTIVE")
    const needsPostFilter = !isSingleStatus && !isAllOrNone;
    const audits = needsPostFilter
      ? rawAudits.filter((a) => statusFilters.includes(a.status as AuditStatus))
      : rawAudits;
    const totalAudits = needsPostFilter ? audits.length : rawTotal;

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
        // why: surface "this one's mine" per row so the companion can
        // render a marker without a second roundtrip per audit. Computed
        // server-side because the asset list endpoint already loads
        // `assignments` for the count above — no extra query cost.
        isAssignedToMe:
          a.assignments?.some((assn) => assn.userId === user.id) ?? false,
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
