import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/bookings/available-kits
 *
 * Availability-aware kit picker for the booking create/edit flow — the kit twin
 * of `bookings.available-assets`. Passes through to the shared
 * `getPaginatedAndFilterableKits`, which marks a kit unavailable when any of its
 * contained assets conflicts (in custody / maintenance / reserved / checked-out)
 * for the requested window.
 *
 * Kits are first-class in equipment reservation (people book bundles like a
 * "wireless mic kit"), and the rest of the mobile booking flow already treats
 * kits as first-class: `add-scanned-assets` expands `kitIds`, and `remove-assets`
 * accepts `kitIds`. This endpoint feeds the picker that drives those.
 *
 * Like the asset picker, the availability filter requires `bookingFrom`,
 * `bookingTo` and `hideUnavailable=true` (the service 400s without both dates).
 *
 * Query: ?orgId & bookingFrom & bookingTo & hideUnavailable=true
 *        & s? (search) & page? & per_page?
 *
 * @see {@link file://./bookings.available-assets.ts} the asset twin
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    // Bookings are a TEAM-tier (premium) feature — gate this booking-kit read
    // like the mutation routes so PERSONAL workspaces can't query it.
    await assertMobileCanUseBookings(organizationId);

    // The kit conflict filter only runs when `currentBookingId` is passed — the
    // service gates it on `if (currentBookingId && hideUnavailable)`. Without it,
    // kits already booked in an overlapping window appear available (silent
    // double-book). Passing the booking being edited both enables the filter AND
    // keeps that booking's own kits selectable (re-add on edit).
    const currentBookingId =
      new URL(request.url).searchParams.get("currentBookingId") ?? undefined;

    const { kits, page, perPage, totalKits, totalPages } =
      await getPaginatedAndFilterableKits({
        // why: the service only drops empty kits (no assets) from `kits` when
        // `extraInclude.assetKits` is set — without it an empty kit passes the
        // availability check and a user could "add" a kit that attaches zero
        // assets (while totalKits already excludes it). Post-quantities the
        // kit→asset link is the AssetKit pivot, so include `assetKits`.
        extraInclude: { assetKits: { select: { id: true } } },
        request,
        organizationId,
        currentBookingId,
      });

    return data({
      kits: kits.map((kit) => ({
        id: kit.id,
        name: kit.name,
        status: kit.status,
      })),
      page,
      perPage,
      totalCount: totalKits,
      totalPages,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
