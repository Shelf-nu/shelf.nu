import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { formatDateForICal } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Escapes text for ICS property values per RFC 5545 §3.3.11 */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds a content line to 75 octets per RFC 5545 §3.1.
 * Continuation lines start with a single space.
 */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join("\r\n");
}

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

    const formattedFromDate = formatDateForICal(booking.from as Date);
    const formattedToDate = formatDateForICal(booking.to as Date);
    const formattedDTSTAMP = formatDateForICal(new Date());

    const bookingUrl = `${SERVER_URL}/bookings/${bookingId}`;

    // Build custodian display name
    const custodianName = booking.custodianUser
      ? `${booking.custodianUser.firstName ?? ""} ${
          booking.custodianUser.lastName ?? ""
        }`.trim()
      : booking.custodianTeamMember?.name ?? "Unassigned";

    // Build asset list
    const assetNames = booking.assets?.map((a) => a.title) ?? [];
    const assetCount = assetNames.length;
    const assetLabel = assetCount === 1 ? "asset" : "assets";
    const assetList =
      assetCount > 0 ? assetNames.join(", ") : "No assets assigned";

    // Build SUMMARY with asset count
    const summary = escapeICalText(
      assetCount > 0
        ? `${booking.name} (${assetCount} ${assetLabel})`
        : booking.name
    );

    // Build rich DESCRIPTION
    const description = escapeICalText(
      `Custodian: ${custodianName}\n` +
        `Assets (${assetCount}): ${assetList}\n\n` +
        `View booking: ${bookingUrl}`
    );

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Shelf.nu//Shelf Calendar 1.0//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `SUMMARY:${summary}`,
      `UID:${booking.id}`,
      `SEQUENCE:${Date.now()}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      `DTSTART:${formattedFromDate}`,
      `DTEND:${formattedToDate}`,
      `DTSTAMP:${formattedDTSTAMP}`,
      "CATEGORIES:Shelf.nu booking",
      `DESCRIPTION:${description}`,
      `URL:${bookingUrl}`,
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      "DESCRIPTION:Equipment due back tomorrow",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    const ics = lines.map(foldLine).join("\r\n");

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
