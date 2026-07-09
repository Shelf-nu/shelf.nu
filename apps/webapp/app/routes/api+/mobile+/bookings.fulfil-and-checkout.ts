import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { fulfilModelRequestsAndCheckout } from "~/modules/booking/service.server";
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
 * units they're taking and this endpoint, in ONE atomic transaction:
 *   1. matches each scanned asset against the outstanding model requests
 *      (materialising them into real `BookingAsset` rows), and
 *   2. transitions the booking RESERVED → ONGOING (full checkout).
 *
 * This is the "scan to assign + check out" flow — the whole point of
 * book-by-model — done in a single motion, mirroring web. Off-model scans
 * that don't match a reservation land as direct `BookingAsset`s (same as web);
 * the server rejects the submit if any request is still outstanding afterwards.
 *
 * Body: {
 *   bookingId: string,
 *   assetIds: string[],   // concrete assets the operator scanned
 *   kitIds?: string[],    // scanned kits (attribution only — no model requests)
 *   timeZone?: string,    // device tz for scheduler/email timestamps
 * }
 *
 * Like the plain checkout endpoint, this is always a "without-adjusted-date"
 * checkout: mobile never sends a `checkoutIntentChoice`, so an early checkout
 * keeps the booking's original `from` rather than rewriting it to "now".
 *
 * @see {@link file://../../../modules/booking/service.server.ts} — `fulfilModelRequestsAndCheckout`
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

    const body = await request.json();
    const { bookingId, assetIds, kitIds, timeZone } = z
      .object({
        bookingId: z.string().min(1),
        assetIds: z.array(z.string()).default([]),
        kitIds: z.array(z.string()).optional().default([]),
        timeZone: z.string().optional(),
      })
      .parse(body);

    // Load the booking's reservation window so the service can run its
    // asset-conflict guard (gated on `from && to`, exactly as the plain
    // checkout endpoint does). Org-scoped, so a foreign-org id 404s.
    const existingBooking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { from: true, to: true },
    });

    if (!existingBooking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Same hint derivation as the plain checkout endpoint: native clients can't
    // set the CH-time-zone cookie, so prefer the device timeZone from the body.
    const hints: ClientHint = {
      ...getClientHint(request),
      ...(timeZone ? { timeZone } : {}),
    };

    const booking = await fulfilModelRequestsAndCheckout({
      bookingId,
      organizationId,
      userId: user.id,
      assetIds,
      kitIds,
      hints,
      // Pass the booking's own window: enables the conflict guard without
      // adjusting any dates (adjustment needs a checkoutIntentChoice, which
      // mobile never sends → stays a "without-adjusted-date" checkout).
      from: existingBooking.from,
      to: existingBooking.to,
    });

    return data({
      success: true,
      booking: {
        id: booking.id,
        name: booking.name,
        status: booking.status,
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
