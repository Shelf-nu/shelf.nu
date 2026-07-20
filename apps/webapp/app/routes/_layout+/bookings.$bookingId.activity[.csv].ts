import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { exportBookingNotesToCsv } from "~/utils/csv.server";
import { makeShelfError, ShelfError } from "~/utils/error";
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

    const { canSeeAllBookings } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.bookingNote,
      action: PermissionAction.read,
    });

    const booking = await db.booking.findFirstOrThrow({
      where: { id: bookingId, organizationId },
      select: {
        name: true,
        custodianUserId: true,
        // Custody can be recorded on the team-member link alone; the gate
        // below matches on either link, so both must be selected.
        custodianTeamMember: { select: { userId: true } },
      },
    });

    /**
     * Both permission checks above pass for BASE and SELF_SERVICE, so the org
     * scope alone would let either role export any booking's activity feed by
     * id. Mirrors the gate on the activity route this CSV mirrors.
     */
    if (!canSeeBooking({ canSeeAllBookings, booking, userId })) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        additionalData: { userId, bookingId, organizationId },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

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
