import { BookingStatus, OrganizationRoles } from "@prisma/client";
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
import { deleteBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/delete
 *
 * Permanently deletes a booking from the Companion app — the mobile twin of the
 * web "delete" intent. Wraps the shared `deleteBooking` service (which frees
 * assets, cancels the scheduler and removes the PDF).
 *
 * PARITY: `delete` maps to `PermissionAction.delete` (web intent2ActionMap).
 * The two guards that on web live ONLY in the route action (not the service)
 * are re-implemented here EXACTLY (overview.tsx:783-809), or this would be a
 * privilege escalation vs web:
 *   1. self-service/base may only delete their own (creator OR custodian) —
 *      via the shared `validateBookingOwnership`.
 *   2. BASE users may only delete DRAFT bookings.
 *
 * Body: { bookingId: string }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (delete intent)
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
      action: PermissionAction.delete,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId } = BodySchema.parse(await request.json());

    const { role } = await getMobileUserContext(user.id, organizationId);

    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        creatorId: true,
        custodianUserId: true,
        status: true,
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Mirror the web delete guards (overview.tsx:783-809) exactly.
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;

    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking,
        userId: user.id,
        role,
        action: "delete",
      });

      // BASE users can only delete DRAFT bookings.
      if (
        role === OrganizationRoles.BASE &&
        booking.status !== BookingStatus.DRAFT
      ) {
        throw new ShelfError({
          cause: null,
          message:
            "You are not authorized to delete this booking. BASE users can only delete draft bookings.",
          status: 403,
          label: "Booking",
          shouldBeCaptured: false,
        });
      }
    }

    await deleteBooking(
      { id: bookingId, organizationId },
      getClientHint(request),
      user.id
    );

    return data({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
