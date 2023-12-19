import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { commitAuthSession, requireAuthSession } from "~/modules/auth";
import { upsertBooking } from "~/modules/booking";
import {
  requireOrganisationId,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { setCookie } from "~/utils/cookies.server";

/**
 * In the case of bookings, when the user clicks "new", we automatically create the booking.
 * In order to not have to manage 2 different pages for new and view/edit we do some simple but big brain strategy
 * In the .new route we dont even return any html, we just create a draft booking and directly redirect to the .bookingId route.
 * This way all actions are available and its way easier to manage so in a way this works kind of like a resource route.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const booking = await upsertBooking({
    organizationId,
    name: "Draft booking",
    creatorId: authSession.userId,
  });

  return redirect(`/bookings/${booking.id}`, {
    headers: [
      setCookie(await commitAuthSession(request, { authSession })),
      setCookie(await setSelectedOrganizationIdCookie(organizationId)),
    ],
  });
}
