import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const TEAM_MEMBER_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      displayName: true,
      profilePicture: true,
    },
  },
} satisfies Prisma.TeamMemberInclude;

export type AuditTeamMember = Prisma.TeamMemberGetPayload<{
  include: typeof TEAM_MEMBER_INCLUDE;
}>;

/**
 * API endpoint to fetch team members for audit assignment.
 * Only returns team members with users (excludes NRMs).
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.read,
    });

    // Fetch team members who have user accounts (exclude NRMs)
    const teamMembers = await db.teamMember.findMany({
      where: {
        deletedAt: null,
        organizationId,
        user: { isNot: null }, // Only users, no NRMs
      },
      /**
       * Order by the label the picker actually renders. `TeamMember.name` is
       * NOT NULL and `updateUser` keeps it equal to `displayName` when set and
       * `"firstName lastName"` otherwise — the same chain
       * `resolveTeamMemberName` resolves — so it is already a materialised
       * COALESCE, which Prisma's `orderBy` cannot express directly.
       *
       * Leading with `user.displayName` instead splits the list in two:
       * Postgres sorts NULLs last on ASC, so every renamed user is hoisted
       * above every un-renamed one and a display-name "Zoe" precedes a
       * fallback "Aaron". Ordering by `name` also matches the search path in
       * `api+/model-filters`, so the list does not re-sort as the user types.
       */
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: TEAM_MEMBER_INCLUDE,
    });

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
