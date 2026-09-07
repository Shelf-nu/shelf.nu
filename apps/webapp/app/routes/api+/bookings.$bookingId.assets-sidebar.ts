/**
 * API Route: Booking Assets Sidebar (the drawer's payload)
 *
 * Returns the per-booking `bookingAssets` rows plus the qty-progress maps the
 * bookings-list assets drawer (`BookingAssetsSidebar`) renders when a user
 * expands a row.
 *
 * The five bookings-list loaders deliberately no longer ship this data
 * (`includeAssets: false`): it is the heaviest thing on those routes and dead
 * weight for everyone who never opens a drawer. The `bookingAssets` shape here
 * is `BOOKINGS_LIST_ASSETS_INCLUDE` — the same constant `getBookings` attaches
 * on its eager path — which is what guarantees the drawer renders identically
 * whichever query supplied the rows.
 *
 * The read gate mirrors the bookings index exactly: `requirePermission`
 * (booking/read) for the org scope, `bookingDraftVisibilityClause` so drafts
 * stay creator-only, and `canSeeBooking` for the restricted-role custody
 * scope. `booking.read` passes for BASE and SELF_SERVICE too, so the org scope
 * alone would let either role fetch any booking's asset list by id.
 *
 * @see {@link file://./../../components/booking/booking-assets-sidebar.tsx}
 * @see {@link file://./../_layout+/bookings._index.tsx}
 */
import { data, type LoaderFunctionArgs } from "react-router";
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

/**
 * A closed drawer keeps its fetcher mounted for as long as its row is on the
 * page, so without this every action on the bookings list would revalidate the
 * payload of every drawer anybody had opened. Reopening a drawer always
 * refetches (see `loadSidebarAssets`), so nothing goes stale by skipping this.
 *
 * This is a CLIENT export, unlike `loader` — every `*.server` import above is
 * referenced only inside the loader so none of them reaches the browser
 * bundle. See `.claude/rules/no-server-module-in-route-client-exports.md`.
 */
export function shouldRevalidate() {
  return false;
}

/** ConsumptionLog categories that count as units having left the booking. */
const DISPOSITION_CATEGORIES = ["RETURN", "CONSUME", "LOSS", "DAMAGE"] as const;

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
        // Drafts are visible to their creator only — the same clause the index
        // applies, so this route cannot serve a row the list would hide.
        AND: [bookingDraftVisibilityClause(userId)],
      },
      select: {
        id: true,
        custodianUserId: true,
        // Custody can be recorded on the team-member link alone; `canSeeBooking`
        // matches on either link, so select both.
        custodianTeamMember: { select: { userId: true } },
        ...BOOKINGS_LIST_ASSETS_INCLUDE,
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "Booking not found.",
        additionalData: { userId, bookingId, organizationId },
        label: "Booking",
        status: 404,
        shouldBeCaptured: false,
      });
    }

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
       * `assetId → dispositionedQty` for this booking. Feeds the drawer's qty
       * progress indicator and "Partially checked in" badge — the same
       * aggregate the bookings index used to compute page-wide for every row,
       * now scoped to the one booking actually being expanded.
       */
      db.consumptionLog.groupBy({
        by: ["assetId", "category"],
        where: {
          bookingId,
          category: { in: [...DISPOSITION_CATEGORIES] },
        },
        _sum: { quantity: true },
      }),
      /**
       * Progressive-checkout sessions for this booking, summed per asset to
       * drive the amber "partially checked out, no returns yet" badge.
       */
      db.partialBookingCheckout.findMany({
        where: { bookingId },
        select: { assetIds: true, quantities: true },
      }),
    ]);

    /**
     * Per-asset disposition totals AND a per-category breakdown, both derived
     * from the one groupBy above. The tooltip shows Returned / Consumed / Lost
     * / Damaged separately — lost and damaged units should not read the same
     * as units back in the pool.
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
     * `quantities[].length !== assetIds[].length` (often empty). Count one
     * unit per occurrence in that case, matching the service-layer read
     * convention (`countCheckedOutUnitsForAsset` in
     * `~/modules/booking/service.server`).
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
