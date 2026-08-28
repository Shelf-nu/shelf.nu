/**
 * Calendar subscription management (resource route).
 *
 * Cookie-authenticated `action` to generate / regenerate / revoke a member's
 * iCal feed token for a caller-supplied workspace (`organizationId` form
 * field) — not necessarily the cookie's active workspace. This lets the
 * Calendars settings tab manage the feed for any workspace the member
 * belongs to, without requiring them to switch their active org first.
 * Authorization for the target workspace is proven by
 * `assertMemberCanManageCalendar` (membership + Team-workspace entitlement),
 * not by `requirePermission` against the active org. The public,
 * token-authenticated feed itself lives at
 * `api+/calendar.feed.$token[.ics].ts`.
 *
 * @see {@link file://./../../modules/calendar-subscription/service.server.ts}
 */
import { type ActionFunctionArgs, data } from "react-router";
import {
  assertMemberCanManageCalendar,
  buildCalendarFeedUrl,
  getOrCreateCalendarToken,
  revokeCalendarToken,
  rotateCalendarToken,
} from "~/modules/calendar-subscription/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";

/**
 * Generates, regenerates or revokes a member's calendar-feed token for the
 * workspace identified by the `organizationId` form field, selected by the
 * `intent` form field.
 *
 * @param args.request - Carries the cookie session and the `organizationId` /
 *   `intent` (`generate` | `regenerate` | `revoke`) form fields.
 * @param args.context - Load context providing the auth session.
 * @returns `data({ calendarFeedUrl })` — the new feed URL, or `null` after a
 *   revoke — or an error payload (with status) on failure.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const formData = await request.formData();
    const organizationId = String(formData.get("organizationId") ?? "");
    const intent = String(formData.get("intent") ?? "");

    if (!organizationId) {
      throw new ShelfError({
        cause: null,
        message: "Missing workspace.",
        label: "Booking",
        status: 400,
      });
    }
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

    // Prove the caller may manage THIS workspace's feed (membership + entitlement)
    // — organizationId is user-supplied, so this is the org-scope guard.
    await assertMemberCanManageCalendar({ userId, organizationId });

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
