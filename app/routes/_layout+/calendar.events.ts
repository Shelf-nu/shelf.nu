import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getBookingsForCalendar } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// Loader Function to Return Bookings Data
export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, canSeeAllBookings, canSeeAllCustody } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      });

    const calendarEvents = await getBookingsForCalendar({
      request,
      organizationId,
      userId,
      canSeeAllBookings,
      canSeeAllCustody,
    });

    return new Response(JSON.stringify(calendarEvents), {
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
};
