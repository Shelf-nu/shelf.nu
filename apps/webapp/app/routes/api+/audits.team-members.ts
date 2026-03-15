import type { TeamMember, User } from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { db } from "~/database/db.server";
import { queryRaw, sql } from "~/database/sql.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type AuditTeamMember = TeamMember & {
  user: Pick<
    User,
    "id" | "email" | "firstName" | "lastName" | "profilePicture"
  > | null;
};

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
    const rows = await queryRaw<
      Record<string, unknown> & {
        userId: string | null;
        userEmail: string | null;
        userFirstName: string | null;
        userLastName: string | null;
        userProfilePicture: string | null;
      }
    >(
      db,
      sql`SELECT tm.*, u."id" AS "userId", u."email" AS "userEmail",
                 u."firstName" AS "userFirstName",
                 u."lastName" AS "userLastName",
                 u."profilePicture" AS "userProfilePicture"
          FROM "TeamMember" tm
          LEFT JOIN "User" u ON u."id" = tm."userId"
          WHERE tm."deletedAt" IS NULL
            AND tm."organizationId" = ${organizationId}
            AND tm."userId" IS NOT NULL
          ORDER BY u."firstName" ASC, tm."name" ASC`
    );

    const teamMembers = rows.map((r) => {
      const {
        userId: _uId,
        userEmail,
        userFirstName,
        userLastName,
        userProfilePicture,
        ...rest
      } = r;
      return {
        ...rest,
        user: r.userId
          ? {
              id: r.userId,
              email: userEmail,
              firstName: userFirstName,
              lastName: userLastName,
              profilePicture: userProfilePicture,
            }
          : null,
      };
    }) as AuditTeamMember[];

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
