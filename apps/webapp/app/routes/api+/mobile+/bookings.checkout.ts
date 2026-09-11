import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { checkoutBooking } from "~/modules/booking/service.server";
import { isExplicitCheckoutRequired } from "~/modules/booking-settings/explicit-checkout";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import {
  resolveMostPrivilegedRole,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
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
 *
 * Refused with a 403 when the workspace requires explicit check-out for the
 * caller's role: they scan or select the assets instead (partial check-out).
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

    // PARITY with the web booking action: when the workspace requires EXPLICIT
    // check-out for the caller's role, the one-tap check-out is forbidden and
    // they must scan or select the assets (the partial-checkout path). Judged by
    // the most privileged role, as the loader's `canQuickCheckout` is, so the
    // app never offers a button this route refuses.
    const { roles, effectiveRole } = await getMobileUserContext(
      user.id,
      organizationId
    );
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    if (isExplicitCheckoutRequired({ role: effectiveRole, bookingSettings })) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed to quick check-out",
        message:
          "This workspace requires explicit check-out. Scan or select the assets to check them out.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const { bookingId, timeZone } = await parseMobileBody(
      z.object({
        bookingId: z.string().min(1),
        timeZone: z.string().optional(),
      }),
      request,
      "Booking"
    );

    // Load the booking's reservation window so checkoutBooking can run its
    // asset-conflict guard. That guard is gated on `from && to`; without these
    // dates it is skipped, which on mobile silently checks out (double-books)
    // an asset already reserved/checked-out for an overlapping window. The web
    // checkout passes the booking's from/to — mobile must too. Org-scoped, so a
    // foreign-org id 404s.
    const existingBooking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      // creatorId/custodianUserId feed the ownership guard below.
      select: {
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
      },
    });

    if (!existingBooking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Cross-user IDOR guard: SELF_SERVICE holds `booking:checkout` in the
    // permission map, so the role gate above passes for ANY booking id in the
    // organization — they may only check out bookings they created or are
    // custodian of. No-op for ADMIN/OWNER. `checkoutBooking` does not check
    // ownership itself, so without this the route is more permissive than web.
    // Mirrors the guard on bookings.fulfil-and-checkout.ts.
    validateBookingOwnership({
      booking: existingBooking,
      userId: user.id,
      role: resolveMostPrivilegedRole(roles),
      action: "check out",
    });

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
