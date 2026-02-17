import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
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
      action: PermissionAction.update,
    });

    const url = new URL(request.url);
    const { excludeUserId } = getParams(
      Object.fromEntries(url.searchParams),
      z.object({ excludeUserId: z.string() }),
      { additionalData: { userId, organizationId } }
    );

    /** Fetch OWNER and ADMIN users in this org, excluding the target user */
    const userOrgs = await db.userOrganization.findMany({
      where: {
        organizationId,
        userId: { not: excludeUserId },
        roles: {
          hasSome: [OrganizationRoles.OWNER, OrganizationRoles.ADMIN],
        },
      },
      select: {
        roles: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    return userOrgs.map((uo) => ({
      id: uo.user.id,
      name: `${uo.user.firstName ?? ""} ${uo.user.lastName ?? ""}`.trim(),
      email: uo.user.email,
      isOwner: uo.roles.includes(OrganizationRoles.OWNER),
    }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
