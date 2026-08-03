/**
 * API Route: Booking Assets Sidebar (lazy drawer payload)
 *
 * Returns the per-booking `bookingAssets` payload plus the qty-progress
 * maps that the bookings-index assets drawer (`BookingAssetsSidebar`)
 * renders when a user expands a row. The bookings index loader
 * intentionally no longer ships this data (`includeAssets: false`) — it
 * was ~99% dead payload for users who never open the drawer and the
 * dominant serialization/SSR cost of `/bookings` — so the drawer
 * fetches it from here on first open instead.
 *
 * The `bookingAssets` shape is `BOOKINGS_LIST_ASSETS_INCLUDE`, the same
 * constant `getBookings` attaches for eager callers, which is what
 * guarantees an open drawer renders identically to when the index
 * still shipped the payload inline.
 *
 * Auth mirrors the read-side gate of the bookings index:
 * `requirePermission` (booking/read) scopes to the org,
 * `bookingDraftVisibilityClause` hides other users' drafts, and
 * `canSeeBooking` re-applies the restricted-role custody scope so
 * SELF_SERVICE/BASE users can only fetch bookings the index would list
 * for them.
 *
 * @see {@link file://./../../components/booking/booking-assets-sidebar.tsx}
 * @see {@link file://./../../routes/_layout+/bookings._index.tsx}
 */
import { data, type LoaderFunctionArgs } from "react-router";

/**
 * Closed drawers keep their fetcher mounted per row; without this,
 * every page action would revalidate N previously-opened drawers
 * nobody is looking at. Reopening always fetches fresh data
 * (see `loadSidebarAssets`), so skipping revalidation loses nothing.
 */
export function shouldRevalidate() {
  return false;
}
import { z } from "zod";
import type { DispositionBreakdown } from "~/components/booking/booking-assets-sidebar";
import { db } from "~/database/db.server";
import { BOOKINGS_LIST_ASSETS_INCLUDE } from "~/modules/booking/constants";
import { bookingDraftVisibilityClause } from "~/modules/booking/service.server";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, canSeeAllBookings } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    const booking = await db.booking.findFirst({
      where: {
        id: bookingId,
        organizationId,
        // Drafts are visible to their creator only — same clause the
        // index applies, so this route can't leak a row the list hides.
        AND: [bookingDraftVisibilityClause(userId)],
      },
      select: {
        id: true,
        custodianUserId: true,
        // Custody can be recorded on the team-member link alone; the
        // `canSeeBooking` gate matches on either link, so select both.
        custodianTeamMember: { select: { userId: true } },
        ...BOOKINGS_LIST_ASSETS_INCLUDE,
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "Booking not found.",
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    /**
     * `booking.read` passes for BASE and SELF_SERVICE too, so the org
     * scope alone would let either role fetch any booking's asset list
     * by id. Mirrors the gate on the activity routes and the custody
     * restriction `getBookings` applies to the index itself.
     */
    if (!canSeeBooking({ canSeeAllBookings, booking, userId })) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to view this booking",
        additionalData: { userId, bookingId, organizationId },
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const [dispositionRows, checkoutSessionRows] = await Promise.all([
      /**
       * `assetId → dispositionedQty` input (sum of RETURN + CONSUME +
       * LOSS + DAMAGE ConsumptionLog rows) for this booking. Feeds the
       * sidebar's qty progress indicator and "Partially checked in"
       * badge — the same aggregate the bookings index used to compute
       * page-wide before the drawer went lazy, now scoped to the one
       * booking actually being expanded.
       */
      db.consumptionLog.groupBy({
        by: ["assetId", "category"],
        where: {
          bookingId,
          category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
        },
        _sum: { quantity: true },
      }),
      /**
       * Progressive-checkout sessions for this booking. Sums
       * `PartialBookingCheckout.quantities[i]` per `assetIds[i]` to
       * drive the sidebar's amber
       * `PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN` badge.
       */
      db.partialBookingCheckout.findMany({
        where: { bookingId },
        select: { assetIds: true, quantities: true },
      }),
    ]);

    /**
     * Per-asset disposition totals AND a per-category breakdown. The
     * sidebar tooltip uses the breakdown to show Returned / Consumed /
     * Lost / Damaged separately (lost and damaged units are
     * conceptually different from returned ones). Both derivations
     * come from the same single groupBy — no extra DB round-trip.
     */
    const dispositionedByAsset: Record<string, number> = {};
    const dispositionBreakdownByAsset: Record<string, DispositionBreakdown> =
      {};
    for (const row of dispositionRows) {
      const qty = row._sum.quantity ?? 0;

      dispositionedByAsset[row.assetId] =
        (dispositionedByAsset[row.assetId] ?? 0) + qty;

      const bucket = dispositionBreakdownByAsset[row.assetId] ?? {
        returned: 0,
        consumed: 0,
        lost: 0,
        damaged: 0,
      };
      const next = { ...bucket };
      if (row.category === "RETURN") next.returned += qty;
      else if (row.category === "CONSUME") next.consumed += qty;
      else if (row.category === "LOSS") next.lost += qty;
      else if (row.category === "DAMAGE") next.damaged += qty;
      dispositionBreakdownByAsset[row.assetId] = next;
    }

    /**
     * Per-asset progressively-checked-out total.
     *
     * Legacy fallback: pre-progressive-checkout rows have
     * `quantities[].length !== assetIds[].length` (often empty). We
     * count one unit per occurrence in that case, matching the
     * service-layer read convention (`countCheckedOutUnitsForAsset` in
     * `apps/webapp/app/modules/booking/service.server.ts`).
     */
    const checkedOutByAsset: Record<string, number> = {};
    for (const session of checkoutSessionRows) {
      const ids = session.assetIds ?? [];
      const qtys = session.quantities ?? [];
      const aligned = qtys.length === ids.length;
      for (let i = 0; i < ids.length; i += 1) {
        const assetId = ids[i];
        const quantity = aligned ? qtys[i] ?? 1 : 1;
        checkedOutByAsset[assetId] =
          (checkedOutByAsset[assetId] ?? 0) + quantity;
      }
    }

    return data(
      payload({
        bookingAssets: booking.bookingAssets,
        dispositionedByAsset,
        dispositionBreakdownByAsset,
        checkedOutByAsset,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}
