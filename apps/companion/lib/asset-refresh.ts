/**
 * Cross-screen "this asset changed" signal.
 *
 * The edit screen marks the asset dirty after a successful save and then
 * navigates back; the asset detail's focus effect consumes the flag and
 * refetches. The detail screen otherwise loads its asset only on mount, so
 * without this it keeps showing the pre-edit title, description and fields.
 *
 * Same shape as `booking-refresh.ts` (see there for why a router param does
 * not work for this).
 *
 * @see {@link file://./../app/(tabs)/assets/[id].tsx} consumer
 * @see {@link file://./../app/(tabs)/assets/edit.tsx} producer
 */

// A set (not a single slot) so two assets marked dirty before either is
// consumed don't clobber each other.
const dirtyAssetIds = new Set<string>();

/** Mark an asset as mutated by another screen. */
export function markAssetDirty(id: string) {
  dirtyAssetIds.add(id);
}

/**
 * Returns true (once) if the given asset was marked dirty; clears the flag
 * so later focuses do not refetch again.
 */
export function consumeAssetDirty(id: string): boolean {
  // Set.delete returns true iff the id was present (and removes it).
  return dirtyAssetIds.delete(id);
}
