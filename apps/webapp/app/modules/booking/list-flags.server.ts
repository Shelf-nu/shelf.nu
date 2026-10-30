/**
 * Bookings-list row flags.
 *
 * The five bookings-list loaders (`bookings._index`, `me.bookings`,
 * `kits.$kitId.bookings`, `assets.$assetId.bookings`,
 * `settings.team.users.$userId.bookings`) all render the same row component,
 * and that row shows two decorative pills that are not answerable from the
 * booking record alone:
 *
 * - **"Stock conflict"** — owned by {@link decorateBookingsWithStockConflicts}
 *   in `./stock-conflicts.server`, reused here unchanged.
 * - **"Includes unavailable assets"** — computed here.
 *
 * The second one used to be derived in the browser by walking each row's
 * `bookingAssets` array. That array is no longer shipped with the list (the
 * assets drawer fetches it from `/api/bookings/:bookingId/assets-sidebar` when
 * a row is expanded), so the signal is resolved server-side instead: one
 * bounded query per page, alongside the one the stock pill already runs.
 *
 * Both pills are DECORATIVE. Neither may take a bookings list down, so a
 * failing lookup logs and degrades to "not flagged" rather than throwing.
 *
 * @see {@link file://./stock-conflicts.server.ts}
 * @see {@link file://./../../components/booking/list-bookings-content.tsx}
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import type { CheckoutSession } from "./checkout-attribution";
import {
  checkoutSessionsToLogsByAsset,
  computeSlicesRemainingToCheckOut,
} from "./checkout-attribution";
import {
  decorateBookingsWithStockConflicts,
  type BookingForStockConflictLookup,
} from "./stock-conflicts.server";

const label = "Booking" as const;

/**
 * Statuses where an unavailable asset no longer says anything useful.
 *
 * The booking is finished, cancelled or archived — whatever custody or
 * bookability an asset picked up since then is not this booking's problem, and
 * flagging it would put a permanent warning on historical rows.
 */
const SETTLED_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETE,
  BookingStatus.CANCELLED,
  BookingStatus.ARCHIVED,
];

/**
 * Returns the subset of `bookingIds` that hold at least one unavailable asset.
 *
 * "Unavailable" is deliberately type-aware, mirroring what every other surface
 * already does:
 *
 * - `availableToBook: false` counts for both asset types — the flag means
 *   "never bookable", which is true however the asset counts its units.
 * - Custody counts only for `INDIVIDUAL` assets. One custodian holding the one
 *   physical thing really does compromise the booking. A `QUANTITY_TRACKED`
 *   asset is a pool: handing 20 of 29 units to a custodian leaves 9 bookable,
 *   and a booking drawing on those free units is perfectly valid. The genuine
 *   QT signal is stock, and it has its own pill.
 *
 * @param args.bookingIds - Booking ids on the current page
 * @param args.organizationId - Caller's organization — scopes the query
 * @param args.db - Prisma client or active transaction; defaults to `db`
 * @returns The ids that should show the "Includes unavailable assets" badge
 * @throws {ShelfError} If the query fails
 */
export async function getBookingIdsWithUnavailableAssets({
  bookingIds,
  organizationId,
  db: dbOrTx = db,
}: {
  bookingIds: string[];
  organizationId: string;
  db?: Pick<typeof db, "booking">;
}): Promise<Set<string>> {
  if (bookingIds.length === 0) {
    return new Set();
  }

  try {
    const rows = await dbOrTx.booking.findMany({
      where: {
        id: { in: bookingIds },
        // The ids come from an already org-scoped list query, but this helper
        // is exported and must be safe on its own terms.
        organizationId,
        status: { notIn: SETTLED_BOOKING_STATUSES },
        bookingAssets: {
          some: {
            asset: {
              OR: [
                { availableToBook: false },
                {
                  AND: [
                    { type: { not: AssetType.QUANTITY_TRACKED } },
                    // Any custody row at all — the same bare presence test
                    // `hasCustody` makes in the browser.
                    { custody: { some: {} } },
                  ],
                },
              ],
            },
          },
        },
      },
      select: { id: true },
    });

    return new Set(rows.map((row) => row.id));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while checking the bookings for unavailable assets.",
      additionalData: { organizationId, bookingCount: bookingIds.length },
      label,
    });
  }
}

/**
 * Statuses where the row offers "Check out remaining", the only reader of
 * this flag. A RESERVED row offers a plain "Check out" instead, and a draft or
 * settled booking offers neither.
 */
const UNDERWAY_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/** One underway booking as {@link getBookingIdsWithItemsToCheckOut} reads it. */
type BookingForItemsToCheckOut = {
  bookingAssets: Array<{
    id: string;
    assetId: string;
    quantity: number;
    assetKitId: string | null;
    checkedOutAt: Date | null;
    checkedInAt: Date | null;
    asset: { type: AssetType };
  }>;
  partialCheckouts: CheckoutSession[];
  partialCheckins: Array<{ assetIds: string[] }>;
};

/**
 * Whether one underway booking still has something "Check out remaining"
 * would send. See {@link getBookingIdsWithItemsToCheckOut} for the rule; the
 * candidate slices are already narrowed by its query.
 *
 * @param booking - The booking's candidate slices and its sessions
 * @returns `true` when at least one item would go out
 */
function hasItemsToCheckOut(booking: BookingForItemsToCheckOut): boolean {
  const returned = new Set(
    booking.partialCheckins.flatMap((checkin) => checkin.assetIds)
  );
  const pending = booking.bookingAssets.filter(
    (slice) => !returned.has(slice.assetId)
  );

  // Available individual items go out as they are.
  if (pending.some((slice) => slice.asset.type === AssetType.INDIVIDUAL)) {
    return true;
  }

  // Quantity-tracked slices, grouped per pool: the claims attribute across
  // all of a pool's slices on the booking, never one slice at a time.
  const slicesByAsset = new Map<string, typeof pending>();
  for (const slice of pending) {
    if (slice.asset.type !== AssetType.QUANTITY_TRACKED) continue;
    const group = slicesByAsset.get(slice.assetId) ?? [];
    group.push(slice);
    slicesByAsset.set(slice.assetId, group);
  }
  if (slicesByAsset.size === 0) return false;

  const claimsByAsset = checkoutSessionsToLogsByAsset(
    booking.partialCheckouts,
    (assetId) => slicesByAsset.has(assetId)
  );
  for (const [assetId, slices] of slicesByAsset) {
    const remaining = computeSlicesRemainingToCheckOut({
      slices,
      checkoutClaims: claimsByAsset.get(assetId) ?? [],
      // The query only reads ONGOING and OVERDUE bookings.
      isActiveBooking: true,
    });
    if ([...remaining.values()].some((units) => units > 0)) return true;
  }
  return false;
}

/**
 * Returns the subset of `bookingIds` whose "Check out remaining" would find
 * something to send.
 *
 * Mirrors the server's own rule (`getRemainingCheckoutPayload`), so the row
 * never offers a button the action refuses and never hides one it would
 * carry out:
 *
 * - a QUANTITY_TRACKED slice with units left to send, measured the way the
 *   server measures it: booked quantity minus the scan-session claims
 *   attributed to the slice, with a slice the button sent out in full
 *   reading 0 (`computeSlicesRemainingToCheckOut`). A slice that fully came
 *   back while a sibling slice is still out counts again, as on the server;
 * - an INDIVIDUAL item that is Available now. One in someone's custody or out
 *   on another booking cannot go out, so it does not count;
 * - either way, not an asset a partial check-in already returned on this
 *   booking: the server never sends those out again.
 *
 * One bounded query per page. The query narrows to candidate slices (every
 * slice of a pool, since claim attribution needs the siblings, and only
 * Available individual items); the rest is the server's pure helpers, run in
 * memory.
 *
 * @param args.bookingIds - Booking ids on the current page
 * @param args.organizationId - Caller's organization, which scopes the query
 * @param args.db - Prisma client or active transaction; defaults to `db`
 * @returns The ids that still have items to check out
 * @throws {ShelfError} If the query fails
 */
export async function getBookingIdsWithItemsToCheckOut({
  bookingIds,
  organizationId,
  db: dbOrTx = db,
}: {
  bookingIds: string[];
  organizationId: string;
  db?: Pick<typeof db, "booking">;
}): Promise<Set<string>> {
  if (bookingIds.length === 0) {
    return new Set();
  }

  try {
    const rows = await dbOrTx.booking.findMany({
      where: {
        id: { in: bookingIds },
        // The ids come from an already org-scoped list query, but this helper
        // is exported and must be safe on its own terms.
        organizationId,
        status: { in: UNDERWAY_BOOKING_STATUSES },
      },
      select: {
        id: true,
        bookingAssets: {
          where: {
            OR: [
              { asset: { type: AssetType.QUANTITY_TRACKED } },
              {
                asset: {
                  type: AssetType.INDIVIDUAL,
                  status: AssetStatus.AVAILABLE,
                },
              },
            ],
          },
          select: {
            id: true,
            assetId: true,
            quantity: true,
            assetKitId: true,
            checkedOutAt: true,
            checkedInAt: true,
            asset: { select: { type: true } },
          },
        },
        partialCheckouts: {
          select: { assetIds: true, quantities: true, bookingAssetIds: true },
        },
        partialCheckins: { select: { assetIds: true } },
      },
    });

    return new Set(rows.filter(hasItemsToCheckOut).map((row) => row.id));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while checking the bookings for items still to check out.",
      additionalData: { organizationId, bookingCount: bookingIds.length },
      label,
    });
  }
}

/**
 * Runs one decorative lookup, degrading to "no booking flagged" on failure.
 *
 * Each flag is cosmetic, so a failing lookup logs and the list renders
 * without that flag rather than failing with a 500.
 *
 * @param lookup - The lookup, resolving to the flagged booking ids
 * @param failureMessage - What to log when it fails
 * @param context - Extra data for the log line
 * @returns The flagged ids, or an empty set when the lookup failed
 */
function flagOrNone(
  lookup: Promise<Set<string>>,
  failureMessage: string,
  context: { organizationId: string; bookingCount: number }
): Promise<Set<string>> {
  return lookup.catch((cause) => {
    Logger.error(
      new ShelfError({
        cause,
        message: failureMessage,
        additionalData: context,
        label,
      })
    );
    return new Set<string>();
  });
}

/**
 * Loader helper: decorates a bookings-list page's rows with the two pill flags
 * and the "items still to check out" flag the row's check-out button reads.
 *
 * Runs the lookups concurrently: they are independent, and serialising them
 * would put more round trips on the critical path of every bookings list.
 *
 * @param args.bookings - The loader's booking rows (each needs at least
 *   `{ id, status, from, to }`; extra fields are preserved)
 * @param args.organizationId - Caller's organization, which scopes every query
 * @returns The same rows, each extended with `hasStockConflict`,
 *   `hasUnavailableAssets` and `hasItemsToCheckOut`
 */
export async function decorateBookingsForList<
  B extends BookingForStockConflictLookup,
>({
  bookings,
  organizationId,
}: {
  bookings: B[];
  organizationId: string;
}): Promise<
  Array<
    B & {
      hasStockConflict: boolean;
      hasUnavailableAssets: boolean;
      hasItemsToCheckOut: boolean;
    }
  >
> {
  const bookingIds = bookings.map((booking) => booking.id);
  const context = { organizationId, bookingCount: bookings.length };

  const [withStockConflicts, unavailableIds, itemsToCheckOutIds] =
    await Promise.all([
      // The stock decorator swallows its own failures; the other two have to
      // swallow theirs too, or a decorative flag takes the list down.
      decorateBookingsWithStockConflicts({ bookings, organizationId }),
      flagOrNone(
        getBookingIdsWithUnavailableAssets({ bookingIds, organizationId }),
        "Failed to check the bookings for unavailable assets; rendering the bookings list without that badge.",
        context
      ),
      flagOrNone(
        getBookingIdsWithItemsToCheckOut({ bookingIds, organizationId }),
        "Failed to check the bookings for items still to check out; rendering the bookings list without the row's Check out remaining button.",
        context
      ),
    ]);

  return withStockConflicts.map((booking) => ({
    ...booking,
    hasUnavailableAssets: unavailableIds.has(booking.id),
    hasItemsToCheckOut: itemsToCheckOutIds.has(booking.id),
  }));
}
