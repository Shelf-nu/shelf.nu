/**
 * Public, subscribable iCal feed of a member's bookings.
 *
 * Authentication is the secret token in the URL — calendar clients (Google,
 * Apple, Outlook) cannot send cookies — so this route is registered in
 * `publicPaths` (server/index.ts) to bypass the cookie-session middleware. The
 * token resolves to a single member; bookings are scoped exactly like the
 * in-app calendar. Output is served inline as `text/calendar` so the URL is
 * subscribable rather than a one-off download.
 *
 * Note: calendar clients refresh subscribed URLs on their own schedule (often
 * several hours), so this feed is auto-updating but not real-time.
 *
 * @see {@link file://./../../modules/calendar-subscription/service.server.ts}
 */
import { type LoaderFunctionArgs } from "react-router";
import { getBookingsForICalFeed } from "~/modules/booking/service.server";
import {
  getCalendarFeedContext,
  resolveCalendarVisibility,
} from "~/modules/calendar-subscription/service.server";
import { SERVER_URL } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { buildBookingICalendar, buildBookingVEvent } from "~/utils/ics";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";

/** Plain-text response so calendar clients fail cleanly (never the app's HTML error page). */
function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Serves the member's bookings as a subscribable iCal document.
 *
 * @param params.token - The secret feed token from the URL
 * @returns A `text/calendar` Response on success, or a plain-text 404 (unknown
 *   or revoked token) / 500 (unexpected error). Never throws to the client.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;

  if (!token) {
    return plain("Calendar feed not found", 404);
  }

  try {
    const context = await getCalendarFeedContext(token);
    if (!context) {
      // Unknown or revoked token.
      return plain("Calendar feed not found", 404);
    }

    const { canSeeAllBookings, canSeeAllCustody } = resolveCalendarVisibility({
      roles: context.roles,
      organization: context.organization,
    });

    const bookings = await getBookingsForICalFeed({
      organizationId: context.organizationId,
      userId: context.userId,
      canSeeAllBookings,
    });

    const events = bookings.map((booking) =>
      buildBookingVEvent({
        id: booking.id,
        name: booking.name,
        from: booking.from as Date,
        to: booking.to as Date,
        // Omit the custodian when the member isn't entitled to see custody.
        custodianName: canSeeAllCustody
          ? resolveUserDisplayName(booking.custodianUser) ||
            booking.custodianTeamMember?.name ||
            "Unassigned"
          : "",
        assetTitles: booking.bookingAssets.map((ba) => ba.asset.title),
        bookingUrl: `${SERVER_URL}/bookings/${booking.id}`,
        updatedAt: booking.updatedAt,
      })
    );

    const ics = buildBookingICalendar(events, {
      calendarName: `${context.organization.name} · Shelf bookings`,
    });

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // Inline (not an attachment) so the URL is subscribable. A short cache
        // is plenty since clients poll on their own schedule.
        "Content-Disposition": 'inline; filename="shelf-bookings.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (cause) {
    // Do NOT pass the token in additionalData — it is the feed's sole credential
    // and additionalData is written to logs and sent to Sentry.
    const reason = makeShelfError(cause);
    Logger.error(reason);
    return plain("Unable to generate calendar feed", 500);
  }
}
