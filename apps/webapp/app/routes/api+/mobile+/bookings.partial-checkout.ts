import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { partialCheckoutBooking } from "~/modules/booking/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * Mobile API — progressive (partial) check-out for a booking.
 *
 * `POST /api/mobile/bookings/partial-checkout`. Checks out the given assets from
 * a RESERVED/ONGOING/OVERDUE booking; the first checkout transitions the booking
 * to ONGOING (or OVERDUE if past its end). Authenticates the mobile session,
 * resolves the org, and requires the `booking:checkout` permission before
 * delegating to {@link partialCheckoutBooking}.
 *
 * @param args - Remix action args; `request` carries the JSON body
 *   `{ bookingId: string; assetIds: string[]; checkouts?: Array<{ assetId: string;
 *   bookingAssetId?: string | null; quantity: number }>; timeZone?: string }` and
 *   mobile auth headers. The optional `checkouts` field enables partial
 *   (sub-quantity) check-outs for PARTIAL-tracked assets; legacy clients omit it
 *   and get INDIVIDUAL semantics driven by `assetIds` alone.
 * @returns JSON `{ success, checkedOutCount, remainingCount, isComplete, booking }`
 *   on success, or `{ error: { message } }` with the appropriate status on failure.
 * @throws Never throws to the caller — errors are normalized via
 *   {@link makeShelfError} into the JSON error response.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.checkout,
    });

    await assertMobileCanUseBookings(organizationId);

    const body = await request.json();
    const { bookingId, assetIds, checkouts, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        // Optional: a QT-only check-out sends its quantities in `checkouts` with
        // an empty `assetIds`. INDIVIDUAL rows still flow through `assetIds`. The
        // service 400s if BOTH are empty, so we don't require a minimum here
        // (mirrors the partial-checkin route).
        assetIds: z.array(z.string().cuid()).optional(),
        /**
         * Optional per-asset checkout payload mirroring the webapp check-in
         * JSON shape. When present, the service uses it to perform partial
         * (sub-quantity) checkouts for PARTIAL-tracked assets. Legacy mobile
         * clients omit this field and continue to receive INDIVIDUAL
         * semantics driven solely by `assetIds`.
         */
        checkouts: z
          .array(
            z.object({
              assetId: z.string().cuid(),
              bookingAssetId: z.string().cuid().nullable().optional(),
              quantity: z.number().int().positive(),
            })
          )
          .optional(),
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

    const result = await partialCheckoutBooking({
      id: bookingId,
      organizationId,
      assetIds,
      checkouts,
      userId: user.id,
      hints,
    });

    return data({
      success: true,
      checkedOutCount: result.checkedOutAssetCount,
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
