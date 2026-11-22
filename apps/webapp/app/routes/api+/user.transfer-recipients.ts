/**
 * Transfer recipients for a role change.
 *
 * Lists the members the change-role dialog offers as the recipient of a
 * member's entities: every member holding a role whose policy may receive
 * transfers, excluding the member being changed. The role change validates
 * the chosen recipient again inside its transaction.
 *
 * @see {@link file://./../../components/workspace/change-role-dialog.tsx}
 * @see {@link file://./../../modules/user/service.server.ts} assertTransferRecipient
 */
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
import { isWorkspaceOwner, rolesWhere } from "~/utils/permissions/role-access";
import { requirePermission } from "~/utils/roles.server";
import { resolveUserDisplayName } from "~/utils/user";

/**
 * `GET /api/user/transfer-recipients?excludeUserId=`: candidate recipients,
 * each flagged when they own the workspace.
 */
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

    /** Members whose role may receive transferred entities, excluding the target */
    const userOrgs = await db.userOrganization.findMany({
      where: {
        organizationId,
        userId: { not: excludeUserId },
        roles: {
          hasSome: rolesWhere((p) => p.membership.canReceiveTransfers),
        },
      },
      select: {
        roles: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
          },
        },
      },
    });

    return data(
      userOrgs.map((uo) => ({
        id: uo.user.id,
        name: resolveUserDisplayName(uo.user),
        email: uo.user.email,
        isOwner: isWorkspaceOwner(uo.roles),
      }))
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
