/**
 * Cross-screen "this booking changed" signal.
 *
 * Flows that mutate a booking from another screen (e.g. the scanner's
 * scan-to-add mode) mark it dirty before navigating back; the booking
 * detail's focus effect consumes the flag and bypasses its 60s
 * stale-while-revalidate gate.
 *
 * why not a router param: expo-router's `navigate` dedupes to the existing
 * screen instance WITHOUT delivering changed search params, so a
 * `?refresh=<ts>` token never reaches a mounted detail screen.
 *
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} consumer
 * @see {@link file://./../app/(tabs)/scanner.tsx} producer (scan-to-add)
 */

// A set (not a single slot) so two bookings marked dirty before either is
// consumed don't clobber each other.
const dirtyBookingIds = new Set<string>();

/** Mark a booking as mutated by another screen. */
export function markBookingDirty(id: string) {
  dirtyBookingIds.add(id);
}

/**
 * Returns true (once) if the given booking was marked dirty; clears the
 * flag so subsequent focuses fall back to the normal freshness gate.
 */
export function consumeBookingDirty(id: string): boolean {
  // Set.delete returns true iff the id was present (and removes it).
  return dirtyBookingIds.delete(id);
}

// A lifecycle mutation on the detail screen (reserve/cancel/archive/delete/
// duplicate) changes a row's status or existence, but the bookings index keeps
// its own 60s stale-while-revalidate gate. This flag lets the detail screen
// force the list to refetch on next focus instead of showing stale rows.
let bookingsListDirty = false;

/** Mark the bookings LIST as needing a refresh after a lifecycle mutation. */
export function markBookingsListDirty() {
  bookingsListDirty = true;
}

/**
 * Returns true (once) if the bookings list was marked dirty; clears the flag so
 * subsequent focuses fall back to the normal freshness gate.
 */
export function consumeBookingsListDirty(): boolean {
  if (!bookingsListDirty) return false;
  bookingsListDirty = false;
  return true;
}
