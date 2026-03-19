import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { partialCheckinBooking } from "~/modules/booking/service.server";
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

    const hints = {
      timeZone: timeZone || "UTC",
      locale: "en-US",
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
