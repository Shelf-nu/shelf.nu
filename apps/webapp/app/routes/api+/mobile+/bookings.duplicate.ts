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
import { duplicateBooking } from "~/modules/booking/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { bookingCustodianIsSelf } from "~/utils/bookings";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/duplicate
 *
 * Duplicates a booking from the Companion app — the mobile twin of the web
 * duplicate route. Wraps the shared `duplicateBooking` service, which clones
 * the source into a fresh DRAFT (assets, custodian, tags, description copied;
 * new from/to defaulted) the user can then edit. Returns the new booking so the
 * app can navigate straight into its edit screen.
 *
 * PARITY: the web duplicate route (bookings.$bookingId.overview.duplicate.tsx)
 * is gated by `PermissionAction.create` and relies on the page loader's
 * read-filter for ownership — which a direct mobile POST bypasses. We add the
 * shared `validateBookingOwnership` guard on the SOURCE booking: a caller who
 * does not write every booking may only duplicate their own. A caller who may
 * only book for themself must also be the source's custodian, because the copy
 * keeps the source custodian. Mobile must never be more permissive than web.
 *
 * Body: { bookingId: string }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.duplicate.tsx} web twin
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
      action: PermissionAction.create,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId } = await parseMobileBody(BodySchema, request, "Booking");

    const { access } = await getMobileUserContext(user.id, organizationId);

    // Org-scoped lookup (foreign-org id 404s) + ownership fields for the guard.
    const source = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        creatorId: true,
        custodianUserId: true,
        from: true,
        to: true,
      },
    });

    if (!source) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // A caller who does not write every booking may only duplicate their own
    // (creator OR custodian).
    validateBookingOwnership({
      booking: source,
      userId: user.id,
      access,
      action: "duplicate",
    });

    // duplicateBooking clones the SOURCE custodian, so the creator-or-custodian
    // guard above isn't enough for a caller who may only book for themself: as
    // the creator alone they would mint a new draft in someone else's custody.
    // Require them to be the custodian so the clone is owned by themselves.
    if (bookingCustodianIsSelf(access) && source.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only duplicate bookings assigned to you.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const newBooking = await duplicateBooking({
      bookingId,
      organizationId,
      userId: user.id,
      request,
      // duplicateBooking now requires explicit dates (quantities restructure).
      // The mobile flow has no date picker, so clone the source booking's
      // window; the duplicate lands as a DRAFT the user can reschedule.
      from: source.from,
      to: source.to,
    });

    return data({
      booking: {
        id: newBooking.id,
        name: newBooking.name,
        status: newBooking.status,
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
