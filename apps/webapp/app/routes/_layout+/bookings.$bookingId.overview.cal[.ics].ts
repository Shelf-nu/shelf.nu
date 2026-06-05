import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import { buildBookingICalendar, buildBookingVEvent } from "~/utils/ics";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveUserDisplayName } from "~/utils/user";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    /** Check if the current user is allowed to read booking */
    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      });

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      request,
    });

    /** For self service & base users, we only allow them to read their own bookings */
    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking,
        userId: authSession.userId,
        role,
        action: "download the calendar for",
        checkCustodianOnly: true,
      });
    }

    const bookingUrl = `${SERVER_URL}/bookings/${bookingId}`;

    // Build custodian display name, falling through to team member
    // or "Unassigned" when the user record has no first/last name.
    const custodianName =
      resolveUserDisplayName(booking.custodianUser) ||
      booking.custodianTeamMember?.name ||
      "Unassigned";

    // Reuse the shared iCal builder so this single-booking download and the
    // subscribable workspace feed emit byte-identical events.
    const ics = buildBookingICalendar([
      buildBookingVEvent({
        id: booking.id,
        name: booking.name,
        from: booking.from as Date,
        to: booking.to as Date,
        custodianName,
        assetTitles: booking.assets?.map((a) => a.title) ?? [],
        bookingUrl,
      }),
    ]);

    // Use ASCII-safe filename for the basic filename parameter, and
    // RFC 5987 filename* for non-ASCII booking names (e.g. Thai, Chinese)
    const safeFilename = `${booking.name
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")} - shelf.nu.ics`;
    const encodedFilename = `UTF-8''${encodeURIComponent(
      `${booking.name} - shelf.nu.ics`
    )}`;

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=${encodedFilename}`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
