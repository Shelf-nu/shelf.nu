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

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // Booking read access gates the calendar — and therefore its feed.
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

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
