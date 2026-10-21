/**
 * Server-side booking redaction for list payloads.
 *
 * The advanced asset index's raw query names the biggest upcoming booking on
 * every row (`topBookingId`, `topBookingName`) so a `Short` stock verdict can
 * say which booking is the problem. That booking is usually someone else's,
 * and a role whose booking visibility is limited to its own bookings
 * (`access.bookings.seeAll` false) may not learn its name or id. The query has
 * no viewer argument, so the identity is removed here, after the query and
 * before the payload leaves the loader.
 *
 * The unit count stays: the shortfall itself is a fact about the asset, not
 * about the booking, and the `Short` figure needs it.
 *
 * Shaped as a per-row pass so other booking identities a row carries can be
 * redacted beside these fields under the same rule.
 *
 * @see {@link file://./custody-visibility.server.ts} The custody counterpart
 * @see {@link file://./booking-authorization.server.ts} `canSeeBooking`, the per-booking rule
 */

/**
 * A list row carrying the advanced query's top-booking projection.
 *
 * Every field is optional so rows from shapes that never select it pass
 * through untouched. Kept free of an index signature: intersecting with
 * `Record<string, unknown>` collapses inference to this constraint and strips
 * loader consumers of their real row type.
 */
export type RowWithTopBooking = {
  topBookingId?: string | null;
  topBookingName?: string | null;
  topBookingUnits?: number | null;
};

/**
 * Removes the top booking's identity from rows the viewer may not see it on.
 *
 * Absent stays absent: a row that never carried `topBookingId` or
 * `topBookingName` does not gain a `null` for it.
 *
 * @param rows - List rows straight from the query.
 * @param args.canSeeAllBookings - The caller's `access.bookings.seeAll`.
 * @returns The input array itself when the viewer may see every booking;
 *   otherwise shallow copies with the booking id and name nulled. The input
 *   array and its rows are left untouched, because callers reuse them.
 */
export function redactTopBookingForViewer<T extends RowWithTopBooking>(
  rows: T[],
  { canSeeAllBookings }: { canSeeAllBookings: boolean }
): T[] {
  if (canSeeAllBookings) {
    return rows;
  }

  // Cast: only existing fields are overwritten with `null`, which every field
  // of the constraint admits. TypeScript cannot verify a spread still
  // satisfies `T`, and widening the signature would erase the caller's type.
  return rows.map(
    (row) =>
      ({
        ...row,
        ...(row.topBookingId === undefined ? {} : { topBookingId: null }),
        ...(row.topBookingName === undefined ? {} : { topBookingName: null }),
      }) as T
  );
}
