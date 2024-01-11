import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { commitAuthSession } from "~/modules/auth";
import { upsertBooking } from "~/modules/booking";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getClientHint } from "~/utils/client-hints";
import { setCookie } from "~/utils/cookies.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

/**
 * In the case of bookings, when the user clicks "new", we automatically create the booking.
 * In order to not have to manage 2 different pages for new and view/edit we do some simple but big brain strategy
 * In the .new route we dont even return any html, we just create a draft booking and directly redirect to the .bookingId route.
 * This way all actions are available and its way easier to manage so in a way this works kind of like a resource route.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { authSession, organizationId, role } = await requirePermision(
    request,
    PermissionEntity.booking,
    PermissionAction.create
  );
  const isSelfService = role === OrganizationRoles.SELF_SERVICE;

  const booking = await upsertBooking(
    {
      organizationId,
      name: "Draft booking",
      creatorId: authSession.userId,
      // If the user is self service, we already set them as the custodian as that is the only possible option
      ...(isSelfService && {
        custodianUserId: authSession.userId,
      }),
    },
    getClientHint(request)
  );

  return redirect(`/bookings/${booking.id}`, {
    headers: [
      setCookie(await commitAuthSession(request, { authSession })),
      setCookie(await setSelectedOrganizationIdCookie(organizationId)),
    ],
  });
}
