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
      orderBy: [
        // Users first
        { user: { firstName: "asc" } },
        // Then by name for any edge cases
        { name: "asc" },
      ],
      include: TEAM_MEMBER_INCLUDE,
    });

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
