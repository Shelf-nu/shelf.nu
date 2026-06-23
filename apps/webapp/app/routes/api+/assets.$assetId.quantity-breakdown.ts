/**
 * Quantity Breakdown API
 *
 * Returns the data the `AssetStatusBadge` needs to render the qty-aware
 * tooltip for a QUANTITY_TRACKED asset (per-booking + per-kit slice
 * breakdown). Called lazily on tooltip-hover from index / picker /
 * scanner-drawer surfaces so the SSR loader doesn't pay the per-row
 * cost up-front; the asset detail page passes the breakdown inline
 * via the loader instead.
 *
 * Shape matches what `getQuantityData` in `asset-status-badge.tsx`
 * expects — `custody[]`, `bookingAssets[]`, `assetKits[]` — so the
 * client can feed the response straight into the same renderer used
 * for the inline path.
 *
 * @see {@link file://./../../components/assets/asset-status-badge.tsx}
 */

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { computeBookingAssetRemainingToCheckOut } from "~/modules/booking/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        type: true,
        quantity: true,
        custody: { select: { quantity: true } },
        bookingAssets: {
          where: {
            booking: { status: { in: ["RESERVED", "ONGOING", "OVERDUE"] } },
          },
          select: {
            quantity: true,
            assetKitId: true,
            booking: { select: { id: true, name: true, status: true } },
          },
        },
        assetKits: {
          select: {
            id: true,
            quantity: true,
            kit: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!asset) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        message: "Asset not found",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    /**
     * Effective-quantity post-processing for ONGOING / OVERDUE rows.
     *
     * The raw `BookingAsset.quantity` is the BOOKED quantity (the snapshot
     * the user reserved at booking time). On the OUT-flow, units can be
     * scanned out progressively via `PartialBookingCheckout` — so the
     * BOOKED total may overstate what's actually checked out at any given
     * moment. The badge tooltip's "Checked out" line on every code-bearing
     * surface needs the EFFECTIVE count (booked − remaining-to-check-out),
     * otherwise it over-reports while a booking is partially scanned out.
     *
     * Per the `getQuantityData` contract (see
     * `~/components/assets/asset-status-badge/quantity-data.ts` L66-82),
     * ONGOING/OVERDUE rows MUST ship the server-computed effective
     * `quantity`. RESERVED rows pass through unchanged — reservations have
     * no claim subtraction (nothing has been scanned out yet).
     *
     * We aggregate per `bookingId` here (one row per booking) — the
     * tooltip already groups by booking, and the canonical reducer
     * `computeBookingAssetRemainingToCheckOut` operates per
     * (bookingId, assetId) so the math is naturally per-booking. The
     * per-slice `assetKitId` discriminator is therefore intentionally
     * dropped on the aggregated ONGOING/OVERDUE rows (set to `null`);
     * the standalone-vs-kit-driven split on those rows isn't recoverable
     * without re-deriving claim attribution per slice, which the
     * tooltip's per-booking summation doesn't need.
     *
     * why: bug #96 — the badge over-reported checked-out units whenever
     * a booking was ONGOING but only partially scanned out (the
     * un-scanned slices were still on the shelf yet counted as
     * checked out). This re-uses the same Wave-B aligned-array /
     * legacy-fallback attribution the OUT-side uses, so both sides
     * agree byte-for-byte on what "checked out" means.
     */
    type BookingAssetRow = (typeof asset.bookingAssets)[number];

    const reservedRows: BookingAssetRow[] = [];
    const activeRows: BookingAssetRow[] = [];
    for (const ba of asset.bookingAssets) {
      const status = ba.booking?.status;
      if (status === "ONGOING" || status === "OVERDUE") {
        activeRows.push(ba);
      } else {
        reservedRows.push(ba);
      }
    }

    // Aggregate active (ONGOING/OVERDUE) rows by bookingId so we call the
    // canonical reducer once per booking — multiple slices of the same
    // asset on the same booking (kit-driven + standalone) share a
    // booking-level claim pool, so per-booking is the correct grain.
    type ActiveBookingAggregate = {
      booking: NonNullable<BookingAssetRow["booking"]>;
      bookedQuantity: number;
    };
    const activeByBooking = new Map<string, ActiveBookingAggregate>();
    for (const ba of activeRows) {
      const bookingId = ba.booking?.id;
      if (!bookingId) continue;
      const existing = activeByBooking.get(bookingId);
      if (existing) {
        existing.bookedQuantity += ba.quantity ?? 0;
      } else {
        activeByBooking.set(bookingId, {
          booking: ba.booking,
          bookedQuantity: ba.quantity ?? 0,
        });
      }
    }

    // Run each booking through `computeBookingAssetRemainingToCheckOut`
    // in parallel — independent reads, no shared state.
    const effectiveActiveRows: BookingAssetRow[] = await Promise.all(
      Array.from(activeByBooking.entries()).map(async ([bookingId, agg]) => {
        const remaining = await computeBookingAssetRemainingToCheckOut(
          db,
          bookingId,
          asset.id
        );
        // effective claimed = booked − remaining-to-check-out, floored at 0
        const effectiveQuantity = Math.max(0, agg.bookedQuantity - remaining);
        return {
          quantity: effectiveQuantity,
          // Per-slice attribution collapses at the aggregate grain — the
          // tooltip groups by booking so the standalone/kit-driven split
          // on the aggregated row isn't meaningful. Surface as standalone
          // (`null`) so the tooltip renders one line per booking.
          assetKitId: null,
          booking: agg.booking,
        };
      })
    );

    // Drop ONGOING/OVERDUE rows with zero effective quantity — they
    // represent bookings where nothing has been scanned out yet (e.g. a
    // brand-new ONGOING booking that hasn't had its first scan). The
    // tooltip should only show bookings that contribute to the
    // checked-out count.
    const cleanedActiveRows = effectiveActiveRows.filter(
      (row) => (row.quantity ?? 0) > 0
    );

    return data(
      payload({
        ...asset,
        bookingAssets: [...reservedRows, ...cleanedActiveRows],
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}
