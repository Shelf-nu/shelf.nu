/**
 * Calendar subscription management (resource route).
 *
 * Cookie-authenticated `action` to generate / regenerate / revoke the current
 * member's iCal feed token. The public, token-authenticated feed itself lives
 * at `api+/calendar.feed.$token[.ics].ts`.
 *
 * @see {@link file://./../../modules/calendar-subscription/service.server.ts}
 */
import { type ActionFunctionArgs, data } from "react-router";
import {
  buildCalendarFeedUrl,
  getOrCreateCalendarToken,
  revokeCalendarToken,
  rotateCalendarToken,
} from "~/modules/calendar-subscription/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertCanUseBookings } from "~/utils/subscription.server";

/**
 * Generates, regenerates or revokes the current member's calendar-feed token,
 * selected by the `intent` form field.
 *
 * @param args.request - Carries the cookie session and the `intent` form field
 *   (`generate` | `regenerate` | `revoke`).
 * @param args.context - Load context providing the auth session.
 * @returns `data({ calendarFeedUrl })` — the new feed URL, or `null` after a
 *   revoke — or an error payload (with status) on failure.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Booking read access gates the calendar — and therefore its feed.
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    // Bookings (and their calendar feed) are a Team-workspace feature.
    // requirePermission only gates by role, so without this a direct POST could
    // still mint or revoke a feed token on a non-Team workspace. Assert the
    // workspace type here too, matching the sibling booking routes (e.g.
    // bookings.export.$fileName[.csv].tsx).
    assertCanUseBookings(currentOrganization);

    const intent = String((await request.formData()).get("intent") ?? "");
    if (
      intent !== "generate" &&
      intent !== "regenerate" &&
      intent !== "revoke"
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid calendar subscription intent.",
        label: "Booking",
        status: 400,
      });
    }

    if (intent === "revoke") {
      await revokeCalendarToken({ userId, organizationId });
      return data({ calendarFeedUrl: null });
    }

    const token =
      intent === "regenerate"
        ? await rotateCalendarToken({ userId, organizationId })
        : await getOrCreateCalendarToken({ userId, organizationId });

    return data({ calendarFeedUrl: buildCalendarFeedUrl(token) });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
