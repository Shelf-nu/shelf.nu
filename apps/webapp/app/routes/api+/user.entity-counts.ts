import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
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
      bookings,
      kits,
      assetReminders,
      images,
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
      db.booking.count({
        where: { creatorId: targetUserId, organizationId },
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
    ]);

    const total =
      assets +
      categories +
      tags +
      locations +
      customFields +
      bookings +
      kits +
      assetReminders +
      images;

    return data(
      payload({
        assets,
        categories,
        tags,
        locations,
        customFields,
        bookings,
        kits,
        assetReminders,
        images,
        total,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
