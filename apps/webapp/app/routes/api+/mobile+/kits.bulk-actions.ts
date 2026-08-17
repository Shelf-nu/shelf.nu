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
import { mobileBulkIdsSchema } from "~/modules/api/mobile-bulk-ids.server";
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
    kitIds: mobileBulkIdsSchema("kitIds"),
    custodianId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("release-custody"),
    kitIds: mobileBulkIdsSchema("kitIds"),
  }),
  z.object({
    intent: z.literal("update-location"),
    kitIds: mobileBulkIdsSchema("kitIds"),
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
          // Mobile passes no `currentSearchParams`, so `getKitsWhereInput`
          // returns before any custodian clause is built and this is inert.
          // It is stated rather than defaulted so a future mobile select-all
          // that DOES forward filters has to make the choice explicitly.
          allowedTeamMemberIds: "all",
        });
        break;
      }

      case "release-custody": {
        // Self-service users may only release kits they hold themselves. The
        // check now lives in `bulkReleaseKitCustody` so it runs on the RESOLVED
        // kits: the version here queried `kitCustody` with the raw
        // `body.kitIds`, so `["all-selected"]` matched zero rows and the guard
        // passed. That mattered more on mobile than on web — no
        // `currentSearchParams` is sent, so the resolved set is every kit in
        // the organization.
        await bulkReleaseKitCustody({
          kitIds: body.kitIds,
          organizationId,
          userId: user.id,
          role,
          // Mobile passes no `currentSearchParams`, so `getKitsWhereInput`
          // returns before any custodian clause is built and this is inert.
          // It is stated rather than defaulted so a future mobile select-all
          // that DOES forward filters has to make the choice explicitly.
          allowedTeamMemberIds: "all",
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
