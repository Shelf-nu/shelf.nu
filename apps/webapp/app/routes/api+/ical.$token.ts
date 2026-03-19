import type { LoaderFunctionArgs } from "react-router";
import { generateICalFeed } from "~/modules/calendar-feed/ical.server";
import { getCalendarFeedByToken } from "~/modules/calendar-feed/service.server";

/**
 * Public iCal feed endpoint.
 * Authenticated via a secret token in the URL (no session required).
 *
 * Usage: GET /api/ical/<token>
 * Returns: text/calendar (RFC 5545)
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;

  if (!token || token.length < 32) {
    return new Response("Not found", { status: 404 });
  }

  const feed = await getCalendarFeedByToken(token);

  if (!feed) {
    return new Response("Not found", { status: 404 });
  }

  const ical = await generateICalFeed({
    userId: feed.userId,
    organizationId: feed.organizationId,
    organizationName: feed.organization.name,
  });

  return new Response(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
