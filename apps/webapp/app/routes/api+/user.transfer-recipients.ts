import { OrganizationRoles } from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { queryRaw, sql } from "~/database/sql.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.teamMember,
      action: PermissionAction.changeRole,
    });

    const url = new URL(request.url);
    const { excludeUserId } = getParams(
      Object.fromEntries(url.searchParams),
      z.object({ excludeUserId: z.string() }),
      { additionalData: { userId, organizationId } }
    );

    /** Fetch OWNER and ADMIN users in this org, excluding the target user */
    const userOrgs = await queryRaw<{
      roles: string[];
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
    }>(
      db,
      sql`
        SELECT uo."roles",
               u."id", u."firstName", u."lastName", u."email"
        FROM "UserOrganization" uo
        JOIN "User" u ON u."id" = uo."userId"
        WHERE uo."organizationId" = ${organizationId}
          AND uo."userId" != ${excludeUserId}
          AND (uo."roles" && ARRAY['OWNER', 'ADMIN']::"OrganizationRoles"[])
      `
    );

    return data(
      userOrgs.map((uo) => ({
        id: uo.id,
        name: `${uo.firstName ?? ""} ${uo.lastName ?? ""}`.trim(),
        email: uo.email,
        isOwner: uo.roles.includes(OrganizationRoles.OWNER),
      }))
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
