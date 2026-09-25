/**
 * Checked-out unit accounting for QUANTITY_TRACKED assets.
 *
 * Computes how many units of an asset are physically off the shelf across its
 * active (ONGOING/OVERDUE) bookings, split into STANDALONE (free-pool) units vs
 * the FULL total (standalone + kit-driven). Lives apart from
 * `booking/service.server` so `asset/availability.server` can consume it
 * without the two modules forming an import cycle: this module depends only on
 * the pure `./checkout-attribution` primitives, `@shelf/quantity-control` and
 * `@prisma/client`.
 *
 * @see {@link file://./checkout-attribution.ts} per-slice attribution and the shared session parser.
 * @see {@link file://../asset/availability.server.ts} the main consumer (`getAssetAvailability`).
 */
import { AssetStatus, BookingStatus, type Asset } from "@prisma/client";
import { RESERVATION_REDUCING_CATEGORIES } from "@shelf/quantity-control";

import {
  checkoutSessionsToLogsByAsset,
  computeUnitsStillOutBySlice,
  type CheckoutAttributionLog,
  type CheckoutSession,
} from "./checkout-attribution";

/**
 * Units of an asset still off the shelf, summed across every ONGOING / OVERDUE
 * booking the asset is on in the given organization: what left on each
 * booking, minus what has come back or been used up. See
 * {@link computeCheckedOutBreakdownForAsset} for the rule and
 * {@link computeUnitsStillOutBySlice} for the per-slice arithmetic.
 *
 * This is the "Checked out" tile on the asset overview and the equivalent
 * field of the public quantity API endpoint.
 *
 * Scoped to `ONGOING` + `OVERDUE`: RESERVED bookings have sent nothing out yet
 * and COMPLETE / ARCHIVED ones have brought everything back. Org-scoped through
 * `booking.organizationId`, so another workspace's bookings never count.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param assetId - Asset whose checked-out count we want
 * @param organizationId - Caller's organization. Scopes the active-booking
 *                        lookup and prevents cross-org leaks
 * @returns Non-negative integer: units of `assetId` still out across all
 *          active bookings in this org
 */
// `tx` is intentionally `any` rather than a structural
// `Pick<ExtendedPrismaClient, "bookingAsset" | "partialBookingCheckout">`: the
// availability module's own `PrismaClientOrTx` client type and the real-impl
// parity tests' in-memory fake clients do NOT satisfy that Pick, so structural
// typing only relocates the escape hatch into an `as` cast at every call site.
// Mirrors the `tx: any` convention of the sibling checkout-remaining helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeCheckedOutForAsset(
  tx: any,
  assetId: Asset["id"],
  organizationId: string
): Promise<number> {
  // Delegate to the breakdown helper and return only its `total`. This keeps
  // the ~1 external caller and every test that reads this function's number
  // working unchanged, while guaranteeing `total` and the standalone/kit split
  // are derived from ONE body and can never drift (bug #2790 ③).
  return (await computeCheckedOutBreakdownForAsset(tx, assetId, organizationId))
    .total;
}

/**
 * Split of {@link computeCheckedOutForAsset}'s physically-out count into its
 * STANDALONE (free-pool) and TOTAL (standalone + kit-driven) parts, computed
 * in one pass so the two can never diverge.
 *
 * The physical-now headline (`total − inCustody − inKits − checkedOut`) must
 * subtract only the STANDALONE units: kit-driven units are already inside
 * `inKits`. The displayed "Checked out" figure is the FULL count. This helper
 * returns both:
 *
 *   - `total`     - every unit of this asset still off the shelf across active
 *                   bookings, kit and standalone alike.
 *   - `standalone`- only the units on standalone (`assetKitId IS NULL`)
 *                   slices, the figure `physicalAvailable` subtracts.
 *
 * Per (booking, asset), the units still out come from
 * {@link computeUnitsStillOutBySlice}: what left (the all-at-once legacy
 * reading, or the larger of the session claims and the stored
 * `checkedOutQuantity`) minus what came back or was used up
 * (RETURN / CONSUME / LOSS / DAMAGE). A partial check-in therefore puts its
 * units back on the shelf straight away, and a consumed unit is not counted as
 * both gone from the stock and still out.
 *
 * The batched sibling in `asset/availability.server.ts` runs the same helper,
 * and `checked-out-batch-parity.test.ts` pins the two together.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param assetId - Asset whose checked-out breakdown we want
 * @param organizationId - Caller's organization. Scopes the active-booking
 *                        lookup and prevents cross-org leaks
 * @returns `{ total, standalone }`: non-negative unit counts; `standalone`
 *          is always `<= total`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `tx` stays `any` for the same reason as computeCheckedOutForAsset above
export async function computeCheckedOutBreakdownForAsset(
  tx: any,
  assetId: Asset["id"],
  organizationId: string
): Promise<{ total: number; standalone: number }> {
  let total = 0;
  let standalone = 0;
  for (const booking of (
    await computeCheckedOutByBookingForAsset(tx, assetId, organizationId)
  ).values()) {
    total += booking.total;
    standalone += booking.standalone;
  }
  return { total, standalone };
}

/**
 * {@link computeCheckedOutBreakdownForAsset}, kept per booking: for each
 * ONGOING / OVERDUE booking the asset is on, the units of it still off the
 * shelf on that booking, split into the full count and its standalone part.
 *
 * Surfaces that list the asset's bookings one line each (the status-badge
 * tooltip, the mobile asset detail) read this, so every line and the overview
 * total are the same numbers.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param assetId - Asset whose checked-out units we want
 * @param organizationId - Caller's organization. Scopes the active-booking
 *                        lookup and prevents cross-org leaks
 * @returns Map keyed by every active booking holding a slice of the asset,
 *          including bookings with nothing out (both counts 0)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `tx` stays `any` for the same reason as computeCheckedOutForAsset above
export async function computeCheckedOutByBookingForAsset(
  tx: any,
  assetId: Asset["id"],
  organizationId: string
): Promise<Map<string, { total: number; standalone: number }>> {
  const byBooking = new Map<string, { total: number; standalone: number }>();

  const slices = (await tx.bookingAsset.findMany({
    where: {
      assetId,
      booking: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId,
      },
    },
    select: {
      id: true,
      quantity: true,
      assetKitId: true,
      bookingId: true,
      checkedOutQuantity: true,
      // Live asset status: the per-asset half of the all-at-once detection in
      // `computeUnitsStillOutBySlice`. Joined here so it costs no round-trip.
      asset: { select: { status: true } },
    },
  })) as Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
    bookingId: string;
    checkedOutQuantity?: number | null;
    asset?: { status: AssetStatus } | null;
  }>;

  if (slices.length === 0) return byBooking;

  /**
   * Whether the asset itself is flagged off the shelf. The all-at-once
   * checkout sets `CHECKED_OUT` on every asset it processed, which separates
   * "was on the booking when it went out" from "added afterwards" (left
   * AVAILABLE by `updateBookingAssets`). Only the former takes the legacy
   * reading.
   */
  const assetIsCheckedOut = slices.some(
    (slice) => slice.asset?.status === AssetStatus.CHECKED_OUT
  );

  // An asset can hold several slices on one booking (a standalone free-pool
  // slice plus kit-driven ones), and attribution is per (booking, asset).
  const slicesByBooking = new Map<
    string,
    Array<{
      id: string;
      quantity: number;
      assetKitId: string | null;
      checkedOutQuantity: number;
    }>
  >();
  for (const slice of slices) {
    const entry = {
      id: slice.id,
      quantity: slice.quantity,
      assetKitId: slice.assetKitId,
      checkedOutQuantity: slice.checkedOutQuantity ?? 0,
    };
    const list = slicesByBooking.get(slice.bookingId);
    if (list) {
      list.push(entry);
    } else {
      slicesByBooking.set(slice.bookingId, [entry]);
    }
  }

  const bookingIds = [...slicesByBooking.keys()];
  const [sessions, dispositionLogs] = await Promise.all([
    tx.partialBookingCheckout.findMany({
      where: { bookingId: { in: bookingIds } },
      select: {
        bookingId: true,
        assetIds: true,
        quantities: true,
        bookingAssetIds: true,
      },
    }) as Promise<
      Array<{
        bookingId: string;
        assetIds: string[];
        quantities: number[];
        bookingAssetIds: string[];
      }>
    >,
    tx.consumptionLog.findMany({
      where: {
        assetId,
        bookingId: { in: bookingIds },
        category: { in: [...RESERVATION_REDUCING_CATEGORIES] },
      },
      select: { bookingId: true, bookingAssetId: true, quantity: true },
    }) as Promise<
      Array<{
        bookingId: string | null;
        bookingAssetId: string | null;
        quantity: number;
      }>
    >,
  ]);

  const sessionsByBooking = new Map<string, CheckoutSession[]>();
  for (const s of sessions) {
    const entry: CheckoutSession = {
      assetIds: s.assetIds,
      quantities: s.quantities,
      bookingAssetIds: s.bookingAssetIds,
    };
    const list = sessionsByBooking.get(s.bookingId);
    if (list) {
      list.push(entry);
    } else {
      sessionsByBooking.set(s.bookingId, [entry]);
    }
  }

  const dispositionsByBooking = new Map<string, CheckoutAttributionLog[]>();
  for (const log of dispositionLogs) {
    if (!log.bookingId) continue;
    const list = dispositionsByBooking.get(log.bookingId) ?? [];
    list.push({ bookingAssetId: log.bookingAssetId, quantity: log.quantity });
    dispositionsByBooking.set(log.bookingId, list);
  }

  for (const [bookingId, bookingSlices] of slicesByBooking) {
    const stillOutBySlice = computeUnitsStillOutBySlice({
      slices: bookingSlices,
      checkoutClaims:
        checkoutSessionsToLogsByAsset(
          sessionsByBooking.get(bookingId) ?? [],
          (id) => id === assetId
        ).get(assetId) ?? [],
      dispositions: dispositionsByBooking.get(bookingId) ?? [],
      assetIsCheckedOut,
    });

    let total = 0;
    let standalone = 0;
    for (const slice of bookingSlices) {
      const out = stillOutBySlice.get(slice.id) ?? 0;
      total += out;
      // A slice is standalone (free-pool) iff it has no kit FK. `== null`
      // matches `attributeDispositionsByBookingAsset`'s own kit-driven test.
      if (slice.assetKitId == null) {
        standalone += out;
      }
    }
    byBooking.set(bookingId, { total, standalone });
  }

  return byBooking;
}
