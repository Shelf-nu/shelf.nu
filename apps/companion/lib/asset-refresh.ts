/**
 * Cross-screen "this asset changed" signal.
 *
 * The edit screen marks an asset changed after a successful save. Screens
 * that show asset data loaded earlier (the asset detail, which loads on mount
 * only, and the assets list, which skips refetches for 60s) compare the
 * version they last saw with the current one when they regain focus, and
 * refetch when it moved.
 *
 * Versions rather than a consume-once flag: the same asset can be open in
 * more than one stack (Assets tab and Audits tab both host the detail
 * screen), and each of them, plus the list, must see the change.
 *
 * Same purpose as `booking-refresh.ts` (see there for why a router param does
 * not work for this).
 *
 * @see {@link file://./../app/(tabs)/assets/[id].tsx} consumer (one asset)
 * @see {@link file://./../app/(tabs)/assets/index.tsx} consumer (any asset)
 * @see {@link file://./../app/(tabs)/assets/edit.tsx} producer
 */

let latestVersion = 0;
const versionByAsset = new Map<string, number>();

/**
 * Records that an asset was changed by another screen.
 *
 * @param id - The asset that changed
 */
export function markAssetChanged(id: string) {
  latestVersion += 1;
  versionByAsset.set(id, latestVersion);
}

/**
 * The change version for one asset, or for all assets when `id` is omitted.
 * A screen stores the value it last rendered and refetches when the current
 * value differs. `0` means nothing has been marked.
 *
 * @param id - The asset to ask about; omit to ask "has any asset changed?"
 * @returns A number that increases with every change it covers
 */
export function assetChangeVersion(id?: string): number {
  if (id === undefined) return latestVersion;
  return versionByAsset.get(id) ?? 0;
}
