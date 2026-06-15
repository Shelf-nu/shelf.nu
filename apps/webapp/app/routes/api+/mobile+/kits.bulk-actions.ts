import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  bulkAssignKitCustody,
  bulkReleaseKitCustody,
  bulkUpdateKitLocation,
} from "~/modules/kit/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/kits/bulk-actions
 *
 * Bulk kit operations for the mobile scanner's batch modes. Wraps the same
 * kit services as the webapp's `api/kits/bulk-actions` route so behavior
 * (custody cascades to contained assets, notes, activity events) is
 * identical across platforms. `bulk-delete` is deliberately not exposed —
 * destructive operations are not a scanner concern.
 *
 * Body: { intent: "assign-custody" | "release-custody" | "update-location",
 *         kitIds: string[], custodianId?: string, newLocationId?: string }
 *
 * @see {@link file://../kits.bulk-actions.ts} the web twin of this route
 */

const BodySchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("assign-custody"),
    kitIds: z.array(z.string().min(1)).min(1),
    custodianId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("release-custody"),
    kitIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    intent: z.literal("update-location"),
    kitIds: z.array(z.string().min(1)).min(1),
    newLocationId: z.string().min(1),
  }),
]);

const intent2ActionMap = {
  "assign-custody": PermissionAction.custody,
  "release-custody": PermissionAction.custody,
  "update-location": PermissionAction.update,
} as const;

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = BodySchema.parse(await request.json());

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.kit,
      action: intent2ActionMap[body.intent],
    });

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    switch (body.intent) {
      case "assign-custody": {
        // Org-scoped custodian lookup — a foreign-org team member 404s here,
        // so custody can never be granted across workspaces.
        // getTeamMember is org-scoped and already throws a 404 "Team member
        // not found" for a true miss while letting infra/DB failures surface
        // (and be captured) as their real error — so don't wrap it in a catch
        // that would flatten every failure into a 404.
        const teamMember = await getTeamMember({
          id: body.custodianId,
          organizationId,
          select: { id: true, name: true, userId: true },
        });

        // Self-service users may only take custody themselves (web parity —
        // the kit services don't take a role param, so the route enforces).
        if (isSelfService && teamMember.userId !== user.id) {
          throw new ShelfError({
            cause: null,
            title: "Action not allowed",
            message: "Self user can only assign custody to themselves only.",
            additionalData: { userId, kitIds: body.kitIds },
            label: "Kit",
            status: 403,
            shouldBeCaptured: false,
          });
        }

        await bulkAssignKitCustody({
          kitIds: body.kitIds,
          organizationId,
          custodianId: teamMember.id,
          custodianName: teamMember.name,
          userId: user.id,
        });
        break;
      }

      case "release-custody": {
        // Self-service users may only release kits they hold themselves
        // (web parity — enforced in the route, the service takes no role).
        if (isSelfService) {
          const custodies = await db.kitCustody.findMany({
            where: {
              kitId: { in: body.kitIds },
              kit: { organizationId },
            },
            select: { custodian: { select: { userId: true } } },
          });

          if (
            custodies.some((custody) => custody.custodian.userId !== user.id)
          ) {
            throw new ShelfError({
              cause: null,
              title: "Action not allowed",
              message: "Self user can release custody of themselves only.",
              additionalData: { userId, kitIds: body.kitIds },
              label: "Kit",
              status: 403,
              shouldBeCaptured: false,
            });
          }
        }

        await bulkReleaseKitCustody({
          kitIds: body.kitIds,
          organizationId,
          userId: user.id,
        });
        break;
      }

      case "update-location": {
        await bulkUpdateKitLocation({
          kitIds: body.kitIds,
          organizationId,
          newLocationId: body.newLocationId,
          userId: user.id,
        });
        break;
      }
    }

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
