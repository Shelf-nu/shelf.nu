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
 * Archives a booking (→ ARCHIVED) from the Companion app — the mobile twin of
 * the web "archive" intent. Wraps the shared `archiveBooking` service, which
 * enforces the archivable-status rule (COMPLETE, or RESERVED already past its
 * end date, see `isBookingArchivable`) and cancels any scheduler.
 *
 * With `discardDraft: true` it is the twin of the web "discard-draft" intent:
 * it archives a DRAFT and nothing else. That is how members without
 * `booking:delete` drop a draft (the detail endpoint's `canDiscardDraft`).
 *
 * PARITY: gate on `PermissionAction.archive` (the web ActionsDropdown shows the
 * archive action via `userHasPermission(archive)`). `booking:update` is not the
 * gate: roles without archive hold it too. We also add the
 * shared `validateBookingOwnership` guard (no-op when the caller's access
 * writes every booking; creator-or-custodian otherwise) since the web relies on
 * the page loader's read-filter that a direct POST bypasses. Mobile must never
 * be more permissive.
 *
 * Body: { bookingId: string, discardDraft?: boolean }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (archive intent)
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  discardDraft: z.boolean().optional(),
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
      action: PermissionAction.archive,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId, discardDraft } = await parseMobileBody(
      BodySchema,
      request,
      "Booking"
    );

    const { access } = await getMobileUserContext(user.id, organizationId);

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
      access,
      action: discardDraft ? "discard" : "archive",
    });

    // archiveBooking enforces the status rule itself: archivable, or DRAFT
    // when discarding.
    const archived = await archiveBooking({
      id: bookingId,
      organizationId,
      userId: user.id,
      discardDraft: discardDraft === true,
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
