import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { checkinBooking } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/bookings/checkin
 *
 * Full check-in: transitions ONGOING/OVERDUE → COMPLETE.
 * All CHECKED_OUT assets return to AVAILABLE.
 *
 * Body: { bookingId: string, timeZone?: string }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkin,
    });

    const body = await request.json();
    const { bookingId, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        timeZone: z.string().optional(),
      })
      .parse(body);

    const hints = {
      timeZone: timeZone || "UTC",
      locale: "en-US",
    };

    const booking = await checkinBooking({
      id: bookingId,
      organizationId,
      hints,
      userId: user.id,
    });

    return data({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        status: booking.status,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
