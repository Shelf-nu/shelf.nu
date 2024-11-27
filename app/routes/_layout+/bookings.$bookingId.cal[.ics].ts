import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getBooking } from "~/modules/booking/service.server";
import { getClientHint } from "~/utils/client-hints";
import { formatDatesForICal } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
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
    const { organizationId, isSelfServiceOrBase, userOrganizations } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      });
    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    /** For self service & base users, we only allow them to read their own bookings */
    if (isSelfServiceOrBase && booking.custodianUserId !== authSession.userId) {
      throw new ShelfError({
        cause: null,
        message:
          "You are not authorized to download the calendar for this booking",
        status: 403,
        label: "Booking",
        shouldBeCaptured: false,
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

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar",
        "Content-Disposition": `attachment; filename="${booking.name} - shelf.nu.ics"`,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
