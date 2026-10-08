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
import { deleteBooking } from "~/modules/booking/service.server";
import { assertCanDeleteBooking } from "~/utils/booking-authorization.server";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/delete
 *
 * Permanently deletes a booking from the Companion app, the mobile twin of the
 * web "delete" intent. Wraps the shared `deleteBooking` service (which frees
 * assets, cancels the scheduler and removes the PDF).
 *
 * PARITY: `delete` maps to `PermissionAction.delete` (web intent2ActionMap).
 * The guard is `assertCanDeleteBooking`, the same one the web delete intent
 * runs: ownership for callers who do not write every booking, and drafts only
 * for roles whose policy says so.
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

    const { bookingId } = await parseMobileBody(BodySchema, request, "Booking");

    const { access } = await getMobileUserContext(user.id, organizationId);

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

    assertCanDeleteBooking({ access, booking, userId: user.id });

    await deleteBooking(
      { id: bookingId, organizationId },
      getClientHint(request),
      user.id,
      // Re-checked at write time: the booking may have left DRAFT since.
      { onlyIfDraft: access.policy.bookings.deleteOnlyDrafts }
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
