import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { fulfilAndCheckOut } from "~/modules/booking/fulfil-and-checkout.server";
import { isExplicitCheckoutRequired } from "~/modules/booking-settings/explicit-checkout";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import {
  resolveMostPrivilegedRole,
  validateBookingOwnership,
} from "~/utils/booking-authorization.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/bookings/fulfil-and-checkout
 *
 * Mobile equivalent of the web `fulfil-and-checkout` scanner route
 * (`_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx`).
 *
 * A book-by-model booking reserves N units of an `AssetModel` up front as
 * intent (`BookingModelRequest`), with no concrete assets behind them yet.
 * The server hard-blocks a plain checkout (RESERVED → ONGOING) while any of
 * those requests are unfulfilled, so on mobile the operator scans the actual
 * units they're taking and this endpoint delegates to `fulfilAndCheckOut`,
 * which:
 *   1. matches each scanned asset against the outstanding model requests
 *      (materialising them into real `BookingAsset` rows), and
 *   2. checks the booking out — the whole booking, or, under the
 *      workspace's explicit check-out requirement, only the scanned units.
 *
 * This is the "scan to assign + check out" flow — the whole point of
 * book-by-model — done in a single motion, mirroring web. Off-model scans
 * that don't match a reservation land as direct `BookingAsset`s (same as web);
 * the server rejects the submit if any request is still outstanding afterwards.
 * Under the explicit check-out requirement only the scanned units are checked
 * out; `remainingCount` says how many booked assets are still to check out.
 *
 * Body: {
 *   bookingId: string,
 *   assetIds: string[],   // concrete assets the operator scanned
 *   kitIds?: string[],    // scanned kits (no model requests); 400 under the explicit check-out requirement
 *   timeZone?: string,    // device tz for scheduler/email timestamps
 * }
 *
 * Like the plain checkout endpoint, this is always a "without-adjusted-date"
 * checkout: mobile never sends a `checkoutIntentChoice`, so an early checkout
 * keeps the booking's original `from` rather than rewriting it to "now".
 *
 * @see {@link file://../../../modules/booking/fulfil-and-checkout.server.ts} — `fulfilAndCheckOut`
 * @see {@link file://./bookings.checkout.ts} — the plain (no model requests) checkout
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

    const { bookingId, assetIds, kitIds, timeZone } = await parseMobileBody(
      z.object({
        bookingId: z.string().min(1),
        assetIds: z.array(z.string()).default([]),
        kitIds: z.array(z.string()).optional().default([]),
        timeZone: z.string().optional(),
      }),
      request,
      "Booking"
    );

    // Load the booking's reservation window so the full check-out can run its
    // asset-conflict guard (gated on `from && to`, exactly as the plain
    // checkout endpoint does). Org-scoped, so a foreign-org id 404s.
    // `creatorId`/`custodianUserId` feed the ownership guard below.
    const existingBooking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
      },
    });

    if (!existingBooking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Cross-user IDOR guard: SELF_SERVICE/BASE hold `booking:checkout` in the
    // permission map, so the role gate above passes for ANY booking id they
    // send — they may only fulfil + check out bookings they created or are
    // custodian of. No-op for ADMIN/OWNER. Web enforces the equivalent via
    // `canUserManageBookingAssets` in the fulfil-and-checkout loader, and
    // `fulfilAndCheckOut` does NOT check ownership itself (unlike the scan-add
    // path, whose guard lives in `processBooking`), so without this the mobile
    // route would be more permissive than web.
    const { roles, effectiveRole } = await getMobileUserContext(
      user.id,
      organizationId
    );
    validateBookingOwnership({
      booking: existingBooking,
      userId: user.id,
      role: resolveMostPrivilegedRole(roles),
      action: "check out",
    });

    // Decided after the booking and ownership checks, so a missing or foreign
    // booking answers 404. Judged by the most privileged role, like
    // the loader's `canQuickCheckout`. Under the requirement only the scanned
    // units are checked out.
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);
    const requireExplicitCheckout = isExplicitCheckoutRequired({
      role: effectiveRole,
      bookingSettings,
    });

    // Same hint derivation as the plain checkout endpoint: native clients can't
    // set the CH-time-zone cookie, so prefer the device timeZone from the body.
    const hints: ClientHint = {
      ...getClientHint(request),
      ...(timeZone ? { timeZone } : {}),
    };

    const result = await fulfilAndCheckOut({
      bookingId,
      organizationId,
      userId: user.id,
      assetIds,
      kitIds,
      hints,
      requireExplicitCheckout,
      // Pass the booking's own window: enables the full check-out's conflict
      // guard without adjusting any dates (adjustment needs a
      // checkoutIntentChoice, which mobile never sends → stays a
      // "without-adjusted-date" checkout).
      from: existingBooking.from,
      to: existingBooking.to,
    });

    return data({
      success: true,
      booking: {
        id: result.booking.id,
        name: result.booking.name,
        status: result.booking.status,
      },
      remainingCount: result.remainingAssetCount,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
