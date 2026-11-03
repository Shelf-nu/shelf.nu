/**
 * Mobile: approve a booking reservation request.
 *
 * The phone's twin of the web `approve-booking` intent. Approval is data on
 * the booking (`approvedAt`/`approvedById`), never a status: the request stays
 * RESERVED and becomes checkout-able. Who may approve is the shared
 * `booking:approve` permission (Owner, Administrator, Manager), the same
 * answer the detail endpoint's `canApprove` flag gives the app.
 *
 * @see {@link file://./../../../modules/booking/service.server.ts} approveBooking
 * @see {@link file://./bookings.$bookingId.ts} canApprove
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { approveBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

const BodySchema = z.object({
  bookingId: z.string().min(1),
});

/**
 * Approves one pending reservation request.
 *
 * @returns `{ booking: { id, name, status, approvedAt } }` on success; a 400 from
 *   the service when the booking is not a pending request
 */
export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;
  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");
    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.approve,
    });
    await assertMobileCanUseBookings(organizationId);

    const { bookingId } = await parseMobileBody(BodySchema, request, "Booking");

    const { access } = await getMobileUserContext(user.id, organizationId);
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, creatorId: true, custodianUserId: true },
    });
    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }
    validateBookingOwnership({
      booking,
      userId: user.id,
      access,
      action: "approve",
    });

    const hints: ClientHint = getClientHint(request);
    const approved = await approveBooking({
      id: bookingId,
      organizationId,
      userId: user.id,
      hints,
    });

    return data({
      booking: {
        id: approved.id,
        name: approved.name,
        status: approved.status,
        approvedAt: approved.approvedAt,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data({ error: reason }, { status: reason.status });
  }
}
