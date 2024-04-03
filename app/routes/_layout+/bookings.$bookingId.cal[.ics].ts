import { OrganizationRoles } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getBooking } from "~/modules/booking/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions/types";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    /** Check if the current user is allowed to read booking */
    const { organizationId, role } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });
    const booking = await getBooking({
      id: bookingId,
      organizationId: organizationId,
    });

    /** Check if the user is self service */
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    /** For self service users, we only allow them to read their own bookings */
    if (isSelfService && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message:
          "You are not authorized to download the calendar for this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const ics = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ZContent.net//Zap Calendar 1.0//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
SUMMARY:${booking.name}
UID:c7614cff-3549-4a00-9152-d25cc1fe077d
SEQUENCE:${Date.now()}
STATUS:CONFIRMED
TRANSP:TRANSPARENT
RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=12
DTSTART:${booking.from}
DTEND:${booking.to}
DTSTAMP:${Date.now()}
CATEGORIES:U.S. Presidents,Civil War People
LOCATION:Hodgenville\, Kentucky
GEO:37.5739497;-85.7399606
DESCRIPTION:Born February 12\, 1809\nSixteenth President (1861-1865)\n\n\n
 \nhttp://AmericanHistoryCalendar.com
URL:http://americanhistorycalendar.com/peoplecalendar/1,328-abraham-lincol
 n
END:VEVENT
END:VCALENDAR`.trim();

    return new Response(ics, {
      headers: {
        // @TODO add caching headers
        "Content-Type": "text/calendar",
        "Content-Disposition": `attachment; filename="${booking.name}.ics"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
