import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { exportBookingNotesToCsv } from "~/utils/csv.server";
import { makeShelfError } from "~/utils/error";
import { buildContentDisposition, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.bookingNote,
      action: PermissionAction.read,
    });

    const booking = await db.booking.findFirstOrThrow({
      where: { id: bookingId, organizationId },
      select: { name: true },
    });

    const csv = await exportBookingNotesToCsv({
      request,
      bookingId,
      organizationId,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": buildContentDisposition(booking.name, {
          fallback: "booking",
          suffix: "-activity",
        }),
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
