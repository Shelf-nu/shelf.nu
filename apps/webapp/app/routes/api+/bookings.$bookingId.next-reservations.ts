/**
 * The extend horizon of one booking.
 *
 * Serves what the Change end date dialog shows before a new end is picked:
 * the first reservation standing after the booking's end that holds an item
 * still out, and the next reservation of each such item. The booking page
 * reads the same value in its own loader; this route is for every other
 * surface that opens the dialog (the bookings list), which has no such loader.
 *
 * The figures are a HINT read outside any transaction. The extend action
 * measures the real clash again on submit, so nothing may gate on them.
 *
 * @see {@link file://./../../components/booking/extend-booking-dialog.tsx}
 * @see {@link file://./../../modules/booking/next-reservations.server.ts}
 */

import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { loadNextReservations } from "~/modules/booking/next-reservations.server";
import {
  canSeeBooking,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Serves the next reservations of one booking's items still out.
 *
 * Guarded exactly like the extend action: the caller needs `booking:extend`,
 * the booking must be in their workspace, and a caller who writes only their
 * own bookings must own it. Without the ownership check the reservations
 * (and the names of other members' bookings) of a colleague's booking would
 * be readable by id.
 *
 * @param args.context - Carries the auth session
 * @param args.request - Read for the active organization
 * @param args.params - Carries `bookingId`
 * @returns `{ nextReservations }`, or an error body with status 403 (no
 *   `booking:extend`, not the owner, or cannot see the booking) / 404 (not in
 *   this workspace)
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.extend,
    });

    // Scoped to the workspace, so an id from another org is a 404 here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        creatorId: true,
        custodianUserId: true,
        custodianTeamMember: { select: { userId: true } },
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        title: "Not found",
        status: 404,
        message: "Booking not found.",
        shouldBeCaptured: false,
      });
    }

    validateBookingOwnership({ booking, userId, access, action: "extend" });

    // The page's own read gate: a creator who may write the booking but no
    // longer sees it (not the custodian, and the workspace hides bookings)
    // must not read its horizon through this route either.
    if (!canSeeBooking({ access, booking, userId })) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        status: 403,
        message: "You are not authorized to view this booking.",
        shouldBeCaptured: false,
      });
    }

    const nextReservations = await loadNextReservations({
      organizationId,
      bookingId: booking.id,
      viewer: { userId, seesAllBookings: access.bookings.seeAll },
    });

    return data(payload({ nextReservations }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    // Returned, not thrown: a fetcher load that receives a thrown response is
    // routed to the nearest error boundary, which would replace the page the
    // dialog sits on. The dialog still works without the horizon.
    return data(error(reason, false), { status: reason.status });
  }
}
