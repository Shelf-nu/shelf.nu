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
import { archiveBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/archive
 *
 * Archives a COMPLETE booking (→ ARCHIVED) from the Companion app — the mobile
 * twin of the web "archive" intent. Wraps the shared `archiveBooking` service,
 * which enforces the COMPLETE-only status guard and cancels any scheduler.
 *
 * PARITY: gate on `PermissionAction.archive` (the web ActionsDropdown shows the
 * archive action via `userHasPermission(archive)`). BASE has `booking:update`
 * but NOT `booking:archive`, so the looser `update` gate would let a BASE user
 * archive via the API even though the UI/permission map deny it. We also add the
 * shared `validateBookingOwnership` guard (no-op for admin/owner; creator-or-
 * custodian for self-service) since the web relies on the page loader's read-
 * filter that a direct POST bypasses. Mobile must never be more permissive.
 *
 * Body: { bookingId: string }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (archive intent)
 */

const BodySchema = z.object({ bookingId: z.string().min(1) });

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
      action: PermissionAction.archive,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId } = BodySchema.parse(await request.json());

    const { role } = await getMobileUserContext(user.id, organizationId);

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
      role,
      action: "archive",
    });

    // archiveBooking enforces the COMPLETE-only status guard itself.
    const archived = await archiveBooking({
      id: bookingId,
      organizationId,
      userId: user.id,
    });

    return data({
      booking: {
        id: archived.id,
        name: archived.name,
        status: archived.status,
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
