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
import { AssetType, BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
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
 * Loader helper: decorates a bookings-list page's rows with both pill flags.
 *
 * Runs the two lookups concurrently — they are independent, and serialising
 * them would put a second round trip on the critical path of every bookings
 * list. Replaces the direct {@link decorateBookingsWithStockConflicts} call
 * the five loaders used to make.
 *
 * @param args.bookings - The loader's booking rows (each needs at least
 *   `{ id, status, from, to }`; extra fields are preserved)
 * @param args.organizationId - Caller's organization — scopes every query
 * @returns The same rows, each extended with `hasStockConflict` and
 *   `hasUnavailableAssets`
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
  Array<B & { hasStockConflict: boolean; hasUnavailableAssets: boolean }>
> {
  const [withStockConflicts, unavailableIds] = await Promise.all([
    decorateBookingsWithStockConflicts({ bookings, organizationId }),
    // The stock decorator swallows its own failures; this one has to swallow
    // its own too, or a decorative badge takes the whole list down with a 500.
    getBookingIdsWithUnavailableAssets({
      bookingIds: bookings.map((booking) => booking.id),
      organizationId,
    }).catch((cause) => {
      Logger.error(
        new ShelfError({
          cause,
          message:
            "Failed to check the bookings for unavailable assets; rendering the bookings list without that badge.",
          additionalData: { organizationId, bookingCount: bookings.length },
          label,
        })
      );
      return new Set<string>();
    }),
  ]);

  return withStockConflicts.map((booking) => ({
    ...booking,
    hasUnavailableAssets: unavailableIds.has(booking.id),
  }));
}
