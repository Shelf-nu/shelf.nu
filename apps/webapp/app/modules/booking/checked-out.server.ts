/**
 * Checked-out unit accounting for QUANTITY_TRACKED assets.
 *
 * Computes how many units of an asset are physically off the shelf across its
 * active (ONGOING/OVERDUE) bookings, split into STANDALONE (free-pool) units vs
 * the FULL total (standalone + kit-driven). Extracted from
 * `booking/service.server` so `asset/availability.server` can consume it
 * WITHOUT the two modules forming an import cycle (`availability` ↔ `service`):
 * this module depends only on the pure `./checkout-attribution` primitives and
 * `@prisma/client`.
 *
 * @see {@link file://./checkout-attribution.ts} — per-slice attribution + the shared session parser.
 * @see {@link file://../asset/availability.server.ts} — the main consumer (`getAssetAvailability`).
 */
import { AssetStatus, BookingStatus, type Asset } from "@prisma/client";

import {
  attributeDispositionsByBookingAsset,
  checkoutSessionsToLogsByAsset,
  type CheckoutSession,
} from "./checkout-attribution";

/**
 * TRUE checked-out unit count for an asset, summed across every
 * ONGOING / OVERDUE booking the asset is on in the given organization.
 *
 * For each active booking that holds slices of this asset:
 *
 *   `checkedOutOnBooking = Σ(BookingAsset.quantity for this asset)
 *                          − computeBookingAssetRemainingToCheckOut(...)`
 *
 * — i.e. "what's booked minus what's still on the shelf for this booking"
 * — and the per-booking values are summed (floored at 0) to give the
 * organization-wide checked-out total for the asset.
 *
 * This is the single source of truth for the "checked out" tile in the
 * asset overview sidebar (bug #96) AND for the equivalent field returned
 * by the public quantity API endpoint — both surfaces previously summed
 * `BookingAsset.quantity` naively, which over-counted whenever a booking
 * was ONGOING but had only been partially scanned out (the un-scanned
 * slices were still on the shelf yet shown as checked out).
 *
 * Attribution of {@link PartialBookingCheckout} claims to this asset is
 * delegated to {@link computeBookingAssetRemainingToCheckOut} — the SAME
 * helper the OUT-flow uses to decide "how many more units can still be
 * scanned out". Reusing that primitive (rather than re-implementing the
 * Wave-B aligned-array / legacy-fallback math here) guarantees the
 * overview-side and the OUT-side agree byte-for-byte on what
 * "checked out" means, and means any future fix to the attribution
 * logic lands in one place.
 *
 * Booking statuses are scoped to `ONGOING` + `OVERDUE` because those are
 * the only states where the asset can be physically off-premises under
 * this booking. RESERVED bookings have not been scanned out yet, and
 * COMPLETE/ARCHIVED bookings have already been returned — neither
 * contributes to "currently checked out". This matches the scope of the
 * naive aggregate the helper is replacing (see
 * `apps/webapp/app/routes/_layout+/assets.$assetId.overview.tsx`).
 *
 * Org-scoped: the BookingAsset query joins through `booking.organizationId`
 * so a caller can never accidentally surface checked-out counts from
 * another workspace.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param assetId - Asset whose true checked-out count we want
 * @param organizationId - Caller's organization — required to scope the
 *                        active-booking lookup and prevent cross-org leaks
 * @returns Non-negative integer — units of `assetId` currently
 *          considered checked out across all active bookings in this org
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
 * Motivation (bug #2790 ③): the asset overview's `physicalAvailable`
 * (`total − inCustody − inKits − checkedOut`) subtracted kit-driven
 * checked-out units TWICE — once via `inKits` (kit membership) and once via
 * `checkedOut` (which sums ALL slices). The physical-now headline must
 * subtract only the STANDALONE checked-out units (kit-driven checkout is
 * already covered by `inKits`), while the DISPLAYED "Checked out" figure must
 * stay the FULL count. This helper returns both:
 *
 *   - `total`     — byte-identical to {@link computeCheckedOutForAsset}: every
 *                   checked-out unit of this asset across active bookings, kit
 *                   and standalone alike (the displayed "Checked out" number).
 *   - `standalone`— only the units checked out via standalone
 *                   (`BookingAsset.assetKitId IS NULL`) slices — the multiplier
 *                   `physicalAvailable` must subtract to avoid double-counting.
 *
 * Attribution mirrors {@link computeCheckedOutForAsset} EXACTLY so `total`
 * parity holds:
 *   - Same active-booking scope (`ONGOING`/`OVERDUE`, org-scoped).
 *   - Same legacy-ONGOING fallback: a booking with ZERO
 *     {@link PartialBookingCheckout} sessions was checked out via the legacy
 *     all-at-once flow, so every booked unit of every slice is physically off
 *     the shelf (each slice's checked-out = its full `quantity`).
 *   - Otherwise, each booking's checkout claims for this asset are attributed
 *     to individual slices via {@link attributeDispositionsByBookingAsset}
 *     (standalone-first greedy fill over the SAME shared positional parser
 *     {@link checkoutSessionsToLogsByAsset} every other read site uses), then
 *     each slice's checked-out = `min(slice.quantity, claimed_for_slice)`.
 *
 * The only difference from the asset-on-booking parent is that this attributes
 * per SLICE (so the standalone vs kit-driven split is available); summing the
 * per-slice checked-out back up yields the same per-booking total the parent
 * computes as `booked − remaining`, so `Σ total` is identical.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param assetId - Asset whose checked-out breakdown we want
 * @param organizationId - Caller's organization — scopes the active-booking
 *                        lookup and prevents cross-org leaks
 * @returns `{ total, standalone }` — non-negative unit counts; `standalone`
 *          is always `≤ total`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- `tx` stays `any` for the same reason as computeCheckedOutForAsset above
export async function computeCheckedOutBreakdownForAsset(
  tx: any,
  assetId: Asset["id"],
  organizationId: string
): Promise<{ total: number; standalone: number }> {
  // Pull every BookingAsset slice for this asset on an active booking in this
  // organization. Unlike the parent's asset-on-booking read, we also select
  // each slice's `id` (to attribute claims per slice) and `assetKitId` (to
  // classify the slice as standalone vs kit-driven).
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
      // Live asset status — the per-asset half of the legacy all-at-once
      // detection below. Joined here so it costs no extra round-trip.
      asset: { select: { status: true } },
    },
  })) as Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
    bookingId: string;
    asset?: { status: AssetStatus } | null;
  }>;

  if (slices.length === 0) return { total: 0, standalone: 0 };

  /**
   * Whether the asset itself is currently flipped off the shelf. The
   * all-at-once checkout sets `CHECKED_OUT` on every asset it processed, so
   * this is what distinguishes "was on the booking when it was checked out"
   * from "added to the booking afterwards" (which `updateBookingAssets` leaves
   * AVAILABLE on purpose). Only the former may take the legacy branch below.
   */
  const assetIsCheckedOut = slices.some(
    (slice) => slice.asset?.status === AssetStatus.CHECKED_OUT
  );

  // Group this asset's slices by booking — an asset can have multiple slices on
  // one booking (a standalone free-pool slice + one or more kit-driven slices),
  // and attribution is per (booking, asset).
  const slicesByBooking = new Map<
    string,
    Array<{ id: string; quantity: number; assetKitId: string | null }>
  >();
  for (const slice of slices) {
    const entry = {
      id: slice.id,
      quantity: slice.quantity,
      assetKitId: slice.assetKitId,
    };
    const list = slicesByBooking.get(slice.bookingId);
    if (list) {
      list.push(entry);
    } else {
      slicesByBooking.set(slice.bookingId, [entry]);
    }
  }

  // Fetch every checkout session for the involved bookings ONCE. Grouped by
  // booking so the legacy-ONGOING detection (does the BOOKING have ANY
  // sessions) matches the parent's per-booking check exactly.
  const bookingIds = [...slicesByBooking.keys()];
  const sessions = (await tx.partialBookingCheckout.findMany({
    where: { bookingId: { in: bookingIds } },
    select: {
      bookingId: true,
      assetIds: true,
      quantities: true,
      bookingAssetIds: true,
    },
  })) as Array<{
    bookingId: string;
    assetIds: string[];
    quantities: number[];
    bookingAssetIds: string[];
  }>;

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

  let total = 0;
  let standalone = 0;

  for (const [bookingId, bookingSlices] of slicesByBooking) {
    const bookingSessions = sessionsByBooking.get(bookingId) ?? [];
    // Claimed-per-slice map: exact for tagged logs, standalone-first greedy for
    // untagged/legacy-attribution logs. Built first so the legacy test below can
    // ask whether THIS asset has any claims at all.
    const claimedBySlice = attributeDispositionsByBookingAsset({
      bookingAssetRows: bookingSlices,
      consumptionLogs:
        checkoutSessionsToLogsByAsset(
          bookingSessions,
          (id) => id === assetId
        ).get(assetId) ?? [],
    });
    const assetHasClaims = bookingSlices.some(
      (slice) => (claimedBySlice.get(slice.id) ?? 0) > 0
    );

    // Legacy all-at-once checkout — mirrors the parent's per-asset branch: this
    // asset is flagged off the shelf and has NO recorded claims on this
    // booking, so the zeroed counters are the all-at-once flow's silence rather
    // than "still on the shelf". Keyed on the asset, not on the booking having
    // zero sessions, so a later batch for a DIFFERENT asset can't resurrect it,
    // and an asset added after the checkout (still AVAILABLE) is never counted
    // as out (GitHub #2815).
    const isLegacyOngoing = assetIsCheckedOut && !assetHasClaims;

    for (const slice of bookingSlices) {
      const checkedOutSlice = isLegacyOngoing
        ? slice.quantity
        : Math.min(slice.quantity, claimedBySlice?.get(slice.id) ?? 0);
      total += checkedOutSlice;
      // A slice is standalone (free-pool) iff it has no kit FK. `!= null`
      // (not `=== null`) matches `attributeDispositionsByBookingAsset`'s own
      // kit-driven test and treats a missing/undefined FK as standalone.
      if (slice.assetKitId == null) {
        standalone += checkedOutSlice;
      }
    }
  }

  return { total, standalone };
}
