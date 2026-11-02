/**
 * GET /api/mobile/notification-preferences
 * PUT /api/mobile/notification-preferences
 *
 * The signed-in person's push switches, for the companion settings screen.
 * Switches belong to a person, not a workspace, so only the bearer token is
 * checked.
 *
 * - `GET` answers `{ preferences, pushAvailable, organizationsWithPush }`.
 *   `preferences` holds the four switches, all on for someone who never
 *   changed them. `organizationsWithPush` lists the caller's workspaces whose
 *   tier includes push, and `pushAvailable` says whether there is any.
 * - `PUT` takes any of `pushEnabled`, `bookings`, `audits`,
 *   `stockAndReminders` as booleans, saves them, leaves the others as they
 *   were, and answers `{ preferences }` with all four.
 *
 * @see {@link file://../../../modules/push/preferences.server.ts}
 */
import {
  data,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "~/modules/push/preferences.server";
import type { NotificationPreferences } from "~/modules/push/types";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { getActionMethod, logException } from "~/utils/http.server";
import { filterOrganizationsWithPush } from "~/utils/subscription.server";

/** PUT body: the switches to change. Unknown keys are dropped. */
const UpdatePreferencesSchema = z
  .object({
    pushEnabled: z.boolean(),
    bookings: z.boolean(),
    audits: z.boolean(),
    stockAndReminders: z.boolean(),
  } satisfies Record<keyof NotificationPreferences, z.ZodBoolean>)
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "Send at least one notification setting to change.",
  });

/** Turns a caught error into the JSON error the companion reads. */
function errorResponse(cause: unknown) {
  const reason = makeShelfError(cause);
  logException(reason);
  return data(
    { error: { message: reason.message } },
    { status: reason.status }
  );
}

/** Answers the caller's switches and where push can reach them. */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const [preferences, memberships] = await Promise.all([
      getNotificationPreferences(user.id),
      db.userOrganization.findMany({
        where: { userId: user.id },
        select: { organizationId: true },
      }),
    ]);
    const organizationsWithPush = await filterOrganizationsWithPush(
      memberships.map(({ organizationId }) => organizationId)
    );

    return data({
      preferences,
      pushAvailable: organizationsWithPush.length > 0,
      organizationsWithPush,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

/** Saves some of the caller's switches. */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);

    const method = getActionMethod(request);
    if (method !== "PUT") {
      throw notAllowedMethod(method);
    }

    const changes = await parseMobileBody(
      UpdatePreferencesSchema,
      request,
      "Push"
    );
    const preferences = await updateNotificationPreferences(user.id, changes);

    return data({ preferences });
  } catch (cause) {
    return errorResponse(cause);
  }
}
