/**
 * Blocker list for the drawer that adds scanned assets to a kit.
 *
 * Derived here, as a pure function of the scanned rows and the kit, so
 * `kit-scan-blockers.test.tsx` can pin every blocker by its `id`. A drawer
 * component is impractical to mount in a test, and a blocker that never fires
 * lets a row through that the server then refuses, taking the whole batch with
 * it.
 *
 * @see {@link file://./add-assets-to-kit-drawer.tsx}
 * @see {@link file://./../blockers-factory.tsx} renders what this returns
 */

import { AssetStatus } from "@prisma/client";
import type { ScanListItems } from "~/atoms/qr-scanner";
import { hasCustody } from "~/modules/custody/utils";
import type { BlockerConfig } from "../blockers-factory";
import {
  archivedAssetIdsOf,
  archivedAssetsBlocker,
  assetsOf,
  errorQrIdsOf,
  invalidCodesBlocker,
} from "./scan-blocker-helpers";
import type { ScanBlockerRemovers, ScanBlockers } from "./scan-blocker-helpers";

/** What the kit drawer hands its builder. */
export type AddToKitBlockerArgs = ScanBlockerRemovers & {
  /** The scanned rows, keyed by the code that resolved them. */
  items: ScanListItems;
  /** The kit being added to. */
  kitId: string;
  /** The kit's member asset ids, as the page loaded them. */
  kitAssetIds: ReadonlySet<string>;
};

/**
 * Blockers for the add-assets-to-kit drawer.
 *
 * Kits cannot nest, so every scanned kit blocks. An archived asset that is
 * already a member raises both `assets-already-added` and `assets-archived`;
 * resolving either drops the row.
 *
 * @param args - The scanned rows, the kit and the removers
 * @returns The blocker configs, in display order
 */
export function buildAddToKitBlockers({
  items,
  kitId,
  kitAssetIds,
  removeAssetsFromList,
  removeItemsFromList,
}: AddToKitBlockerArgs): ScanBlockers {
  const assets = assetsOf(items);
  const errorQrIds = errorQrIdsOf(items);

  const assetsAlreadyAddedIds = assets
    .filter((asset) => kitAssetIds.has(asset.id))
    .map((asset) => asset.id);

  // Custody makes an asset unavailable for kit assignment, matching the
  // server, unless the custody comes from this very kit.
  const assetsWithCustodyIds = assets
    .filter(
      (asset) =>
        hasCustody(asset.custody) && asset.assetKits[0]?.kitId !== kitId
    )
    .map((asset) => asset.id);

  const assetsCheckedOutIds = assets
    .filter((asset) => asset.status === AssetStatus.CHECKED_OUT)
    .map((asset) => asset.id);

  const kitQrIds = Object.entries(items)
    .filter(([, item]) => !!item && item.type === "kit")
    .map(([qrId]) => qrId);

  const archivedAssetIds = archivedAssetIdsOf(assets);

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "assets-already-added",
      condition: assetsAlreadyAddedIds.length > 0,
      count: assetsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already added to this kit.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      id: "assets-with-custody",
      condition: assetsWithCustodyIds.length > 0,
      count: assetsWithCustodyIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          unavailable for kit assignment.
        </>
      ),
      description:
        "Assets with custody cannot be added to kits. Please release custody first.",
      onResolve: () => removeAssetsFromList(assetsWithCustodyIds),
    },
    {
      id: "assets-checked-out",
      condition: assetsCheckedOutIds.length > 0,
      count: assetsCheckedOutIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          checked out.
        </>
      ),
      description:
        "Checked out assets cannot be added to kits. Please check them in first.",
      onResolve: () => removeAssetsFromList(assetsCheckedOutIds),
    },
    {
      id: "kits-not-allowed",
      condition: kitQrIds.length > 0,
      count: kitQrIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s" : ""}`}</strong> detected.
          Kits cannot be added to other kits.
        </>
      ),
      description: "Note: Only individual assets can be added to kits.",
      onResolve: () => removeItemsFromList(kitQrIds),
    },
    archivedAssetsBlocker(
      archivedAssetIds,
      removeAssetsFromList,
      "Archived assets can't be added to a kit."
    ),
    invalidCodesBlocker(errorQrIds, removeItemsFromList),
  ];

  return { blockerConfigs };
}
