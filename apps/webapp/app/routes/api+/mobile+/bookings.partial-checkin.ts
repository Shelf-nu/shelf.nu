import { OrganizationRoles } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  assertMobileCanUseBookings,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { partialCheckinBooking } from "~/modules/booking/service.server";
import { canUserManageBookingAssets } from "~/utils/bookings";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/partial-checkin
 *
 * Partial check-in: checks in specific assets from an ONGOING/OVERDUE booking.
 * If all remaining assets are checked in, the booking transitions to COMPLETE.
 *
 * Eligibility mirrors the web checkin-assets loader: self-service users may
 * check in only when the booking is ONGOING/OVERDUE AND they are its
 * custodian; everyone else goes through `canUserManageBookingAssets`
 * (rejects COMPLETE / ARCHIVED / CANCELLED).
 *
 * Body: { bookingId: string, assetIds: string[], timeZone?: string }
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.checkin-assets.tsx} web twin
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkin,
    });

    await assertMobileCanUseBookings(organizationId);

    const body = await request.json();
    const { bookingId, assetIds, checkins, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        // Legacy / INDIVIDUAL: bare asset ids. For a QUANTITY_TRACKED asset a
        // bare id still means "check in all remaining" (simple case); explicit
        // per-unit dispositions go in `checkins`. Optional so the picker can
        // send a QT-only, checkins-only payload.
        assetIds: z.array(z.string().min(1)).optional(),
        // Per-asset dispositions for QUANTITY_TRACKED assets — how many units
        // were returned / consumed / lost / damaged. Powers the mobile
        // check-in picker; mirrors the web drawer payload the service already
        // accepts.
        checkins: z
          .array(
            z.object({
              assetId: z.string().min(1),
              bookingAssetId: z.string().nullish(),
              returned: z.number().int().min(0).optional(),
              consumed: z.number().int().min(0).optional(),
              lost: z.number().int().min(0).optional(),
              damaged: z.number().int().min(0).optional(),
            })
          )
          .optional(),
        timeZone: z.string().optional(),
      })
      .parse(body);

    // Org-scoped booking lookup — a foreign-org booking id 404s here.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        status: true,
        from: true,
        to: true,
        custodianUserId: true,
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const isCheckinEligible =
      booking.status === "ONGOING" || booking.status === "OVERDUE";
    const isCustodian = booking.custodianUserId === user.id;
    const canCheckin =
      isSelfService && isCheckinEligible && isCustodian
        ? true
        : canUserManageBookingAssets(booking, isSelfService);

    if (!canCheckin) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "You cannot check in assets for this booking at the moment. The booking may not be ongoing or you may not have permission to manage its assets.",
        additionalData: { userId: user.id, bookingId, status: booking.status },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Derive hints the standard way: locale from the request's Accept-Language
    // header and timeZone from the CH-time-zone cookie (UTC fallback). Native
    // clients can't set that cookie, so they pass their device timeZone in the
    // body — prefer it when present.
    const hints: ClientHint = {
      ...getClientHint(request),
      ...(timeZone ? { timeZone } : {}),
    };

    const result = await partialCheckinBooking({
      id: bookingId,
      organizationId,
      assetIds,
      checkins,
      userId: user.id,
      hints,
    });

    return data({
      success: true,
      checkedInCount: result.checkedInAssetCount,
      remainingCount: result.remainingAssetCount,
      isComplete: result.isComplete,
      booking: {
        id: result.booking.id,
        name: result.booking.name,
        status: result.booking.status,
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
