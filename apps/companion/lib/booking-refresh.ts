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

let dirtyBookingId: string | null = null;

/** Mark a booking as mutated by another screen. */
export function markBookingDirty(id: string) {
  dirtyBookingId = id;
}

/**
 * Returns true (once) if the given booking was marked dirty; clears the
 * flag so subsequent focuses fall back to the normal freshness gate.
 */
export function consumeBookingDirty(id: string): boolean {
  if (dirtyBookingId === id) {
    dirtyBookingId = null;
    return true;
  }
  return false;
}
