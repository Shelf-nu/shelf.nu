import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { partialCheckinBooking } from "~/modules/booking/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/bookings/partial-checkin
 *
 * Partial check-in: checks in specific assets from an ONGOING/OVERDUE booking.
 * If all remaining assets are checked in, the booking transitions to COMPLETE.
 *
 * Body: { bookingId: string, assetIds: string[], timeZone?: string }
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

    const body = await request.json();
    const { bookingId, assetIds, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        assetIds: z.array(z.string().min(1)).min(1),
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

    const result = await partialCheckinBooking({
      id: bookingId,
      organizationId,
      assetIds,
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
