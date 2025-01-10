import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const TEAM_MEMBER_INCLUDE = {
  custodies: true,
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

export type ReminderTeamMember = Prisma.TeamMemberGetPayload<{
  include: typeof TEAM_MEMBER_INCLUDE;
}>;

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

    return json(data({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
