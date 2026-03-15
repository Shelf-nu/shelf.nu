import type { Custody, TeamMember, User } from "@shelf/database";
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
};

export type ReminderTeamMember = TeamMember & {
  custodies: Custody[];
  user: Pick<
    User,
    "id" | "email" | "firstName" | "lastName" | "profilePicture"
  > | null;
};

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

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
