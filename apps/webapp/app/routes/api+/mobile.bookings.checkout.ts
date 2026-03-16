import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { checkoutBooking } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * POST /api/mobile/bookings/checkout
 *
 * Checks out a RESERVED booking, transitioning it to ONGOING.
 * All assets are set to CHECKED_OUT status.
 *
 * Body: { bookingId: string, timeZone?: string }
 *
 * For mobile, we always do "without-adjusted-date" to keep things simple.
 * The mobile user just taps "Check Out" and it happens.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

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

    const booking = await checkoutBooking({
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
