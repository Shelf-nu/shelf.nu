import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getClientHint } from "~/utils/client-hints";
import { formatDatesForICal } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

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
    const hints = getClientHint(request);

    const formattedFromDate = formatDatesForICal(booking.from as Date, hints);
    const formattedToDate = formatDatesForICal(booking.to as Date, hints);
    const formattedDTSTAMP = formatDatesForICal(new Date(Date.now()), hints);

    const ics = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ZContent.net//Zap Calendar 1.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
SUMMARY:${booking.name}
UID:${booking.id}
SEQUENCE:${Date.now()}
STATUS:CONFIRMED
TRANSP:TRANSPARENT
DTSTART:${formattedFromDate}
DTEND:${formattedToDate}
DTSTAMP:${formattedDTSTAMP}
CATEGORIES:Shelf.nu booking
LOCATION:shelf.nu
DESCRIPTION:Shelf.nu booking (Asset / Equipment checkout)
URL:${SERVER_URL}/bookings/${bookingId}
END:VEVENT
END:VCALENDAR`.trim();

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
