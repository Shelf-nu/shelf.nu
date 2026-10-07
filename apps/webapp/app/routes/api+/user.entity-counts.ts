/**
 * Entity counts for a proposed role change.
 *
 * Counts, for a proposed role change, the entities that change would move to a
 * new owner. The change-role dialog shows these numbers before the admin
 * confirms. Only the kinds the change moves are counted, using the same
 * `roleChangeTransfers` answer and the same booking predicate as the role
 * change itself, so the numbers the admin confirms are exactly what moves.
 *
 * @see {@link file://./../../components/workspace/change-role-dialog.tsx}
 * @see {@link file://./../../modules/user/service.server.ts} transferOnRoleChange
 */
import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { bookingsReassignedOnDemotionWhere } from "~/modules/user/service.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import { roleChangeTransfers } from "~/utils/permissions/membership-access";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * `GET /api/user/entity-counts?userId=&role=`: what changing `userId` to
 * `role` would move.
 *
 * @returns Per-kind counts, their `total`, and `transfers` (which kinds move)
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
    const { userId: targetUserId, role: newRole } = getParams(
      Object.fromEntries(url.searchParams),
      z.object({ userId: z.string(), role: z.nativeEnum(OrganizationRoles) }),
      { additionalData: { userId, organizationId } }
    );

    const target = await db.userOrganization.findFirst({
      where: { userId: targetUserId, organizationId },
      select: { roles: true },
    });

    if (!target) {
      throw new ShelfError({
        cause: null,
        message: "User is not a member of this organization",
        additionalData: { targetUserId, organizationId },
        label: "Team",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    // The same answer the role change itself uses, so the numbers the admin
    // confirms are exactly what moves.
    const transfers = roleChangeTransfers({
      fromRoles: target.roles,
      to: newRole,
    });
    const none = Promise.resolve(0);
    const own = transfers.ownership;

    const [
      assets,
      categories,
      tags,
      locations,
      customFields,
      kits,
      assetReminders,
      images,
      bookings,
    ] = await Promise.all([
      own
        ? db.asset.count({
            where: { userId: targetUserId, organizationId },
          })
        : none,
      own
        ? db.category.count({
            where: { userId: targetUserId, organizationId },
          })
        : none,
      own
        ? db.tag.count({
            where: { userId: targetUserId, organizationId },
          })
        : none,
      own
        ? db.location.count({
            where: { userId: targetUserId, organizationId },
          })
        : none,
      own
        ? db.customField.count({
            where: { userId: targetUserId, organizationId, deletedAt: null },
          })
        : none,
      own
        ? db.kit.count({
            where: { createdById: targetUserId, organizationId },
          })
        : none,
      own
        ? db.assetReminder.count({
            where: { createdById: targetUserId, organizationId },
          })
        : none,
      own
        ? db.image.count({
            where: { userId: targetUserId, ownerOrgId: organizationId },
          })
        : none,
      // Bookings the user created for a DIFFERENT registered custodian, the
      // only bookings a role change reassigns. Uses the exact predicate the
      // transfer runs, so this count and the rows actually moved cannot drift.
      transfers.bookingsCreatedForOthers
        ? db.booking.count({
            where: bookingsReassignedOnDemotionWhere({
              userId: targetUserId,
              organizationId,
            }),
          })
        : none,
    ]);

    const total =
      assets +
      categories +
      tags +
      locations +
      customFields +
      kits +
      assetReminders +
      images +
      bookings;

    return data(
      payload({
        assets,
        categories,
        tags,
        locations,
        customFields,
        kits,
        assetReminders,
        images,
        bookings,
        total,
        transfers,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
