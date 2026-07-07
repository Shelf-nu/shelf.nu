import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { checkoutBooking } from "~/modules/booking/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

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

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkout,
    });

    await assertMobileCanUseBookings(organizationId);

    const body = await request.json();
    const { bookingId, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        timeZone: z.string().optional(),
      })
      .parse(body);

    // Load the booking's reservation window so checkoutBooking can run its
    // asset-conflict guard. That guard is gated on `from && to`; without these
    // dates it is skipped, which on mobile silently checks out (double-books)
    // an asset already reserved/checked-out for an overlapping window. The web
    // checkout passes the booking's from/to — mobile must too. Org-scoped, so a
    // foreign-org id 404s.
    const existingBooking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { from: true, to: true },
    });

    if (!existingBooking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Derive hints the standard way: locale from the request's Accept-Language
    // header and timeZone from the CH-time-zone cookie (UTC fallback). Native
    // clients can't set that cookie, so they pass their device timeZone in the
    // body — prefer it when present.
    const hints: ClientHint = {
      ...getClientHint(request),
      ...(timeZone ? { timeZone } : {}),
    };

    const booking = await checkoutBooking({
      id: bookingId,
      organizationId,
      hints,
      userId: user.id,
      // Pass the booking's own window: this enables the conflict guard without
      // adjusting any dates (date adjustment requires intentChoice, which mobile
      // never sends — so this stays a "without-adjusted-date" checkout).
      from: existingBooking.from,
      to: existingBooking.to,
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
