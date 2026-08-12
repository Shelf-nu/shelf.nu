/**
 * NRM (Non-Registered Member) Scope Helpers
 *
 * Single source of truth for "which TeamMember rows are NRMs visible on the
 * /settings/team/nrm index". The index, the CSV export, and bulk delete all
 * operate on that same population, so they MUST derive their Prisma `where`
 * from here rather than hand-rolling one.
 *
 * Why this exists: the export and bulk-delete select-all branches used a bare
 * `{ organizationId }`, which silently widened the population to every
 * TeamMember row in the org — soft-deleted members, the rows belonging to
 * registered users, and members with a pending invite. Users saw ~2k rows on
 * the index and got ~5k rows in the export.
 *
 * @see {@link file://./service.server.ts} bulkDeleteNRMs (select-all delete)
 * @see {@link file://./../settings/service.server.ts} getPaginatedAndFilterableSettingTeamMembers (the index)
 * @see {@link file://./../../utils/csv.server.ts} exportNRMsToCsv (the export)
 */
import type { Organization, Prisma } from "@prisma/client";
import { InviteStatuses } from "@prisma/client";
import { ALL_SELECTED_KEY } from "~/utils/list";

/**
 * Builds the base `where` matching exactly the NRMs the index lists.
 *
 * The three predicates beyond `organizationId` are what make a TeamMember an
 * NRM, and every one of them is load-bearing:
 * - `deletedAt: null` — NRM delete is a SOFT delete, so deleted rows persist.
 * - `userId: null` — a TeamMember linked to a User is a registered member and
 *   belongs on the Users tab, not here.
 * - no PENDING invite — an invited-but-not-yet-accepted member is shown on the
 *   Invites tab instead.
 *
 * @param params.organizationId - The active organization; scopes out other tenants
 * @param params.search - Optional free-text search, matched against the member
 *   name and the linked user's first/last name (mirrors the index)
 * @returns A Prisma `where` selecting only index-visible NRMs
 */
export function getNrmIndexWhere({
  organizationId,
  search,
}: {
  organizationId: Organization["id"];
  search?: string | null;
}): Prisma.TeamMemberWhereInput {
  const where: Prisma.TeamMemberWhereInput = {
    deletedAt: null,
    organizationId,
    userId: null,
    receivedInvites: {
      none: { status: InviteStatuses.PENDING },
    },
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { user: { firstName: { contains: search, mode: "insensitive" } } },
      { user: { lastName: { contains: search, mode: "insensitive" } } },
    ];
  }

  return where;
}

/**
 * Builds the `where` for a bulk operation driven by the index's selection,
 * honouring the ALL_SELECTED_KEY sentinel.
 *
 * Both branches keep the full NRM base scope, so an explicitly-passed id that
 * is soft-deleted (or belongs to a registered user) can never be acted on —
 * the ids arrive from the client and are not trustworthy on their own.
 *
 * `search` is applied ONLY on the select-all branch: "select all" means "every
 * row matching the filters I currently have applied", whereas an explicit id
 * list is already the post-filter result and must not be narrowed twice.
 *
 * @param params.nrmIds - Selected ids, or a list containing ALL_SELECTED_KEY
 * @param params.organizationId - The active organization
 * @param params.search - The index's active search, forwarded on select-all
 * @returns A Prisma `where` for the selected NRMs
 */
export function getNrmSelectionWhere({
  nrmIds,
  organizationId,
  search,
}: {
  nrmIds: string[];
  organizationId: Organization["id"];
  search?: string | null;
}): Prisma.TeamMemberWhereInput {
  if (nrmIds.includes(ALL_SELECTED_KEY)) {
    return getNrmIndexWhere({ organizationId, search });
  }

  return {
    ...getNrmIndexWhere({ organizationId }),
    id: { in: nrmIds },
  };
}
