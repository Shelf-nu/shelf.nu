/**
 * Reminder recipient candidates.
 *
 * Feeds the team member selector in the set and edit reminder dialogs.
 *
 * @see {@link file://./../../components/asset-reminder/team-members-selector.tsx}
 */
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
import { requireAnyPermission } from "~/utils/roles.server";

/** What the reminder recipient picker renders for each candidate. */
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

/** A reminder recipient candidate as the picker receives it. */
export type ReminderTeamMember = Prisma.TeamMemberGetPayload<{
  include: typeof TEAM_MEMBER_INCLUDE;
}>;

/**
 * Lists the candidates for a reminder's recipients. It serves both the create
 * and the edit reminder dialogs, so either reminder permission opens it.
 *
 * @returns The workspace's candidate recipients
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId } = await requireAnyPermission({
      userId,
      request,
      anyOf: [
        {
          entity: PermissionEntity.assetReminders,
          action: PermissionAction.create,
        },
        {
          entity: PermissionEntity.assetReminders,
          action: PermissionAction.update,
        },
      ],
    });

    const teamMembers = await db.teamMember.findMany({
      where: {
        deletedAt: null,
        organizationId,
        AND: [
          { user: { isNot: null } },
          {
            user: {
              userOrganizations: {
                some: {
                  AND: [
                    { organizationId },
                    { roles: { hasSome: ["ADMIN", "OWNER"] } },
                  ],
                },
              },
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: TEAM_MEMBER_INCLUDE,
    });

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
