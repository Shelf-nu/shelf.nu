import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { count } from "~/database/query-helpers.server";
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
      count(db, "asset", { userId: targetUserId, organizationId }),
      count(db, "category", { userId: targetUserId, organizationId }),
      count(db, "tag", { userId: targetUserId, organizationId }),
      count(db, "location", { userId: targetUserId, organizationId }),
      count(db, "customField", {
        userId: targetUserId,
        organizationId,
        deletedAt: null,
      }),
      count(db, "booking", { creatorId: targetUserId, organizationId }),
      count(db, "kit", { createdById: targetUserId, organizationId }),
      count(db, "assetReminder", {
        createdById: targetUserId,
        organizationId,
      }),
      count(db, "image", {
        userId: targetUserId,
        ownerOrgId: organizationId,
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
