import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { bookingsReassignedOnDemotionWhere } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
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
    const { userId: targetUserId } = getParams(
      Object.fromEntries(url.searchParams),
      z.object({ userId: z.string() }),
      { additionalData: { userId, organizationId } }
    );

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
      db.asset.count({
        where: { userId: targetUserId, organizationId },
      }),
      db.category.count({
        where: { userId: targetUserId, organizationId },
      }),
      db.tag.count({
        where: { userId: targetUserId, organizationId },
      }),
      db.location.count({
        where: { userId: targetUserId, organizationId },
      }),
      db.customField.count({
        where: { userId: targetUserId, organizationId, deletedAt: null },
      }),
      db.kit.count({
        where: { createdById: targetUserId, organizationId },
      }),
      db.assetReminder.count({
        where: { createdById: targetUserId, organizationId },
      }),
      db.image.count({
        where: { userId: targetUserId, ownerOrgId: organizationId },
      }),
      // Bookings the user created for a DIFFERENT registered custodian — the
      // only bookings a demotion reassigns. Uses the exact predicate the
      // transfer runs, so this count and the rows actually moved cannot drift.
      db.booking.count({
        where: bookingsReassignedOnDemotionWhere({
          userId: targetUserId,
          organizationId,
        }),
      }),
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
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
