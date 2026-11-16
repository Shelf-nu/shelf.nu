import { AuditStatus } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getAuditsForOrganization } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

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
 *     assigned to. Callers who see every audit (`audits.seeAll`) use it to
 *     opt into "just my work" via the companion's filter chip. For callers
 *     limited to assigned audits the filter is already implicit in the
 *     service layer; passing the flag is a no-op for them.
 *
 * Mobile-only sort: results are always ordered by `dueDate asc nulls last,
 * createdAt desc, id asc` so the companion list surfaces overdue and soon-due
 * work first, and pages never overlap. The webapp uses its own column-sort UI
 * and does not hit this endpoint.
 *
 * Every page is a database slice and `totalCount` counts the same filtered
 * rows, for any number of statuses.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    // why: callers limited to assigned audits must never list others:
    // `assignedOnly` makes the service filter server-side, whatever the
    // client's `assignedToMe` flag says.
    const { access, canUseAudits } = await getMobileUserContext(
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

    // Parse and validate status filters (unknown values dropped, repeats
    // removed).
    const validStatuses = Object.values(AuditStatus);
    const statusFilters: AuditStatus[] = statusParam
      ? [
          ...new Set(
            statusParam
              .split(",")
              .map((s) => s.trim())
              .filter((s): s is AuditStatus =>
                validStatuses.includes(s as AuditStatus)
              )
          ),
        ]
      : [];

    // why: every status filter runs in the database, so each page is a true
    // slice and `totalCount`/`totalPages` count the same rows. The companion
    // keeps asking for the next page until it passes `totalPages`, so a
    // count that disagrees with the slice makes it load rows twice.
    // No status means the service default: everything except ARCHIVED. A
    // listed status is always honoured, ARCHIVED included.
    const { audits, totalAudits } = await getAuditsForOrganization({
      organizationId,
      userId: user.id,
      assignedOnly: !access.audits.seeAll,
      page,
      perPage,
      search: searchParam || null,
      status: statusFilters,
      assignedToUserId: assignedToMe ? user.id : null,
      prioritizeDeadlines: true,
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
          displayName: a.createdBy?.displayName ?? null,
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
