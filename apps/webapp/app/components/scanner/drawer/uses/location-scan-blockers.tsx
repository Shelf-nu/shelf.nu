/**
 * Blocker lists for the two location scanner drawers: adding scanned items to
 * one location (from the location's page), and moving scanned items to a
 * location picked in the drawer.
 *
 * Derived here, as pure functions of the scanned rows, so
 * `location-scan-blockers.test.tsx` can pin every blocker by its `id`. A drawer
 * component is impractical to mount in a test, and a blocker that never fires
 * lets a row through that the server then refuses, taking the whole batch with
 * it.
 *
 * Neither list blocks a kit over archived members: moving a kit leaves an
 * archived member's placement where it is and moves the rest.
 *
 * @see {@link file://./add-assets-to-location-drawer.tsx}
 * @see {@link file://./update-location-drawer.tsx}
 * @see {@link file://./../blockers-factory.tsx} renders what these return
 */

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { BlockerConfig } from "../blockers-factory";
import {
  archivedAssetIdsOf,
  archivedAssetsBlocker,
  assetsOf,
  errorQrIdsOf,
  invalidCodesBlocker,
  kitsOf,
  qrIdsForKitIds,
} from "./scan-blocker-helpers";
import type { ScanBlockerRemovers, ScanBlockers } from "./scan-blocker-helpers";

/** What the update-location drawer hands its builder. */
export type UpdateLocationBlockerArgs = ScanBlockerRemovers & {
  /** The scanned rows, keyed by the code that resolved them. */
  items: ScanListItems;
};

/** The add-to-location drawer also knows what the location already holds. */
export type AddToLocationBlockerArgs = UpdateLocationBlockerArgs & {
  /** Asset ids placed at this location, as the page loaded them. */
  locationAssetIds: ReadonlySet<string>;
  /** Kit ids at this location, as the page loaded them. */
  locationKitIds: ReadonlySet<string>;
};

/** Description shared by both drawers' archived blocker. */
const ARCHIVED_DESCRIPTION = "Archived assets can't be moved to a location.";

/**
 * Blockers for the drawer that adds scanned assets and kits to the location
 * whose page it sits on.
 *
 * An archived asset already at this location raises both
 * `assets-already-added` and `assets-archived`; resolving either drops the row.
 *
 * @param args - The scanned rows, the location's current contents and the
 *   removers
 * @returns The blocker configs, in display order
 */
export function buildAddToLocationBlockers({
  items,
  locationAssetIds,
  locationKitIds,
  removeAssetsFromList,
  removeItemsFromList,
}: AddToLocationBlockerArgs): ScanBlockers {
  const assets = assetsOf(items);
  const kits = kitsOf(items);
  const errorQrIds = errorQrIdsOf(items);

  const assetsAlreadyAddedIds = assets
    .filter((asset) => locationAssetIds.has(asset.id))
    .map((asset) => asset.id);

  const qrIdsOfAlreadyAddedKits = qrIdsForKitIds(
    items,
    kits.filter((kit) => locationKitIds.has(kit.id)).map((kit) => kit.id)
  );

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "assets-already-added",
      condition: assetsAlreadyAddedIds.length > 0,
      count: assetsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already added to this location.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      id: "kits-already-added",
      condition: qrIdsOfAlreadyAddedKits.length > 0,
      count: qrIdsOfAlreadyAddedKits.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already added to this location.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfAlreadyAddedKits),
    },
    archivedAssetsBlocker(
      archivedAssetIdsOf(assets),
      removeAssetsFromList,
      ARCHIVED_DESCRIPTION
    ),
    invalidCodesBlocker(errorQrIds, removeItemsFromList),
  ];

  return { blockerConfigs };
}

/**
 * Blockers for the drawer that moves scanned assets and kits to a location
 * picked in the drawer.
 *
 * @param args - The scanned rows and the removers
 * @returns The blocker configs, in display order
 */
export function buildUpdateLocationBlockers({
  items,
  removeAssetsFromList,
  removeItemsFromList,
}: UpdateLocationBlockerArgs): ScanBlockers {
  const blockerConfigs: BlockerConfig[] = [
    archivedAssetsBlocker(
      archivedAssetIdsOf(assetsOf(items)),
      removeAssetsFromList,
      ARCHIVED_DESCRIPTION
    ),
    invalidCodesBlocker(errorQrIdsOf(items), removeItemsFromList),
  ];

  return { blockerConfigs };
}
