import type { Custody, TeamMember, User } from "@shelf/database";
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

    const teamMembers = await queryRaw<ReminderTeamMember>(
      db,
      sql`
        SELECT tm.*,
          COALESCE(
            (SELECT jsonb_agg(c)
             FROM "Custody" c
             WHERE c."teamMemberId" = tm."id"),
            '[]'::jsonb
          ) AS "custodies",
          (SELECT jsonb_build_object(
            'id', u."id",
            'email', u."email",
            'firstName', u."firstName",
            'lastName', u."lastName",
            'profilePicture', u."profilePicture"
          )
          FROM "User" u
          WHERE u."id" = tm."userId") AS "user"
        FROM "TeamMember" tm
        WHERE tm."deletedAt" IS NULL
          AND tm."organizationId" = ${organizationId}
          AND tm."userId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "UserOrganization" uo
            WHERE uo."userId" = tm."userId"
              AND uo."organizationId" = ${organizationId}
              AND (uo."roles" && ARRAY['ADMIN', 'OWNER']::"OrganizationRoles"[])
          )
        ORDER BY tm."createdAt" DESC
      `
    );

    return data(payload({ teamMembers }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
