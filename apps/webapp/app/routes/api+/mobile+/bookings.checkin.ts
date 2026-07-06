import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { checkinBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
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

    await assertMobileCanUseBookings(organizationId);

    // PARITY with the web check-in action (bookings.$bookingId.overview.tsx
    // :1034-1054): when the workspace requires EXPLICIT check-in for the
    // caller's role, the quick "check in all" path is forbidden — they must
    // scan / select the assets (the partial-checkin path). The mobile app must
    // NEVER be more permissive than the web / a workspace's settings, so we
    // enforce the same policy server-side here.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    const explicitCheckinRequired =
      (role === OrganizationRoles.ADMIN &&
        bookingSettings.requireExplicitCheckinForAdmin) ||
      (role === OrganizationRoles.SELF_SERVICE &&
        bookingSettings.requireExplicitCheckinForSelfService);
    if (explicitCheckinRequired) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed to quick check-in",
        message:
          "This workspace requires explicit check-in. Scan or select the assets to check them in.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const body = await request.json();
    const { bookingId, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        timeZone: z.string().optional(),
      })
      .parse(body);

    // Derive hints the standard way: locale from the request's Accept-Language
    // header and timeZone from the CH-time-zone cookie (UTC fallback). Native
    // clients can't set that cookie, so they pass their device timeZone in the
    // body — prefer it when present.
    const hints: ClientHint = {
      ...getClientHint(request),
      ...(timeZone ? { timeZone } : {}),
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
