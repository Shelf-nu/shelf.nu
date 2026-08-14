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
import { cancelBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/cancel
 *
 * Cancels a booking (RESERVED/ONGOING/OVERDUE → CANCELLED) from the Companion
 * app — the mobile twin of the web "cancel" intent. Wraps the shared
 * `cancelBooking` service, which enforces the status guard, frees assets/kits
 * (for ONGOING/OVERDUE), cancels the scheduler, sends the cancellation emails
 * and records the BOOKING_CANCELLED event.
 *
 * PARITY: gate on `PermissionAction.cancel` (the web ActionsDropdown shows the
 * cancel action via `userHasPermission(cancel)`, so a direct mobile POST must
 * require the same — BASE has `booking:update` but NOT `booking:cancel`, so the
 * looser `update` gate would let a BASE user cancel via the API even though the
 * UI/permission map deny it). We also add the shared `validateBookingOwnership`
 * guard (no-op for admin/owner; creator-or-custodian for self-service) since the
 * web relies on the page loader's read-filter that a direct POST bypasses.
 * Mobile must never be more permissive than web.
 *
 * Body: { bookingId: string, cancellationReason?: string (<=500) }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (cancel intent)
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  cancellationReason: z.string().max(500).optional(),
});

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
      action: PermissionAction.cancel,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId, cancellationReason } = BodySchema.parse(
      await request.json()
    );

    const { role } = await getMobileUserContext(user.id, organizationId);

    // Org-scoped lookup (foreign-org id 404s) + ownership fields for the guard.
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

    // Mirror web's effective behavior: self-service/base may only cancel their
    // own (creator OR custodian). No-op for admin/owner.
    validateBookingOwnership({
      booking,
      userId: user.id,
      role,
      action: "cancel",
    });

    // cancelBooking enforces the RESERVED/ONGOING/OVERDUE status guard itself.
    const hints: ClientHint = getClientHint(request);
    const cancelled = await cancelBooking({
      id: bookingId,
      organizationId,
      hints,
      userId: user.id,
      cancellationReason,
    });

    return data({
      booking: {
        id: cancelled.id,
        name: cancelled.name,
        status: cancelled.status,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
