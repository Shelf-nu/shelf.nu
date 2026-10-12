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
import { makeShelfError } from "~/utils/error";
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
 * Gated by `PermissionAction.create`, and by `assertCanDuplicateBooking`, which
 * `duplicateBooking` runs on the source row it copies from: a caller who does not
 * write every booking may only duplicate their own, and a caller who may only
 * book for themself must also be the source's custodian, because the copy
 * keeps the source custodian.
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

    // Org-scoped lookup (a foreign-org id 404s) for the source's window.
    const source = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, from: true, to: true },
    });

    if (!source) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
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
      // The service checks the caller may duplicate the source on the same
      // row it copies from (`assertCanDuplicateBooking`).
      access,
    });

    return data({
      booking: {
        id: newBooking.id,
        name: newBooking.name,
        status: newBooking.status,
      },
      // Archived assets in the source are left out of the copy (issue #382);
      // the app can tell the user how many.
      droppedArchivedCount: newBooking.droppedArchivedCount,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
