/**
 * Shared pieces of the scanner drawers' blocker builders.
 *
 * Each drawer derives its blocker list in a pure builder (see
 * `custody-blockers.tsx`, `booking-scan-blockers.tsx`, `kit-scan-blockers.tsx`,
 * `location-scan-blockers.tsx`) so a test can pin it. These helpers read the
 * scanned-items map the same way in all of them, and build the blockers whose
 * wording is identical across drawers.
 *
 * @see {@link file://./../blockers-factory.tsx} renders what the builders return
 */

import type { ScanListItems } from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import type { BlockerConfig } from "../blockers-factory";

/** What every drawer hands its builder so a resolved blocker can drop rows. */
export type ScanBlockerRemovers = {
  /** Drops rows by ASSET id. */
  removeAssetsFromList: (assetIds: string[]) => void;
  /** Drops rows by the CODE that scanned them, which is how kits are keyed. */
  removeItemsFromList: (qrIds: string[]) => void;
};

/** A built blocker list. "Resolve all" is derived from it by `createBlockers`. */
export type ScanBlockers = {
  blockerConfigs: BlockerConfig[];
};

/**
 * Scanned rows that resolved to an asset.
 *
 * @param items - The scanned-items map
 * @returns The asset payloads, in scan order
 */
export function assetsOf(items: ScanListItems): AssetFromQr[] {
  return Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);
}

/**
 * Scanned rows that resolved to a kit.
 *
 * @param items - The scanned-items map
 * @returns The kit payloads, in scan order
 */
export function kitsOf(items: ScanListItems): KitFromQr[] {
  return Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);
}

/**
 * Codes that failed to resolve to anything.
 *
 * @param items - The scanned-items map
 * @returns The codes whose lookup returned an error
 */
export function errorQrIdsOf(items: ScanListItems): string[] {
  return Object.entries(items)
    .filter(([, item]) => !!item?.error)
    .map(([qrId]) => qrId);
}

/**
 * The codes that scanned the given kits. Kits are removed by the CODE that
 * scanned them, not by kit id, because the scanned-items map is keyed by code.
 *
 * @param items - The scanned-items map
 * @param kitIds - The kits to look up
 * @returns The codes keying those kits' rows
 */
export function qrIdsForKitIds(
  items: ScanListItems,
  kitIds: string[]
): string[] {
  return Object.entries(items)
    .filter(([, item]) => {
      if (!item || item.type !== "kit") return false;
      return kitIds.includes((item.data as KitFromQr)?.id);
    })
    .map(([qrId]) => qrId);
}

/**
 * Archived scanned assets. Archived assets are read-only and still read
 * AVAILABLE, so no status blocker catches them, and the server refuses the
 * whole batch over a single one.
 *
 * @param assets - The scanned asset payloads
 * @returns The ids of the archived ones
 */
export function archivedAssetIdsOf(assets: AssetFromQr[]): string[] {
  return assets
    .filter((asset) => !!asset && !!asset.archivedAt)
    .map((asset) => asset.id);
}

/**
 * Scanned kits whose every member is archived. Bookings and kit custody leave
 * archived members out, so such a kit has nothing to contribute and the server
 * refuses it. A kit with no members at all is not reported here.
 *
 * @param kits - The scanned kit payloads
 * @returns The ids of the kits holding only archived assets
 */
export function kitIdsWithOnlyArchivedAssetsOf(kits: KitFromQr[]): string[] {
  return kits
    .filter(
      (kit) =>
        kit.assetKits.length > 0 &&
        kit.assetKits.every((ak) => !!ak.asset.archivedAt)
    )
    .map((kit) => kit.id);
}

/**
 * Whether a scanned kit holds an active member marked unavailable to book.
 * Archived members are skipped: bookings leave them out of the kit, so their
 * own `availableToBook` says nothing about whether the kit can be booked or
 * checked out.
 *
 * @param kit - The scanned kit payload
 * @returns `true` when some member that would be booked is unavailable
 */
export function kitHasUnavailableActiveMember(kit: KitFromQr): boolean {
  return kit.assetKits.some(
    (ak) => !ak.asset.archivedAt && !ak.asset.availableToBook
  );
}

/**
 * The invalid-code blocker, identical on every drawer.
 *
 * @param errorQrIds - Codes that failed to resolve
 * @param removeItemsFromList - Drops rows by code
 * @returns The blocker config, id `invalid-codes`
 */
export function invalidCodesBlocker(
  errorQrIds: string[],
  removeItemsFromList: (qrIds: string[]) => void
): BlockerConfig {
  return {
    id: "invalid-codes",
    condition: errorQrIds.length > 0,
    count: errorQrIds.length,
    message: (count: number) => (
      <>
        <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
        {count > 1 ? "are" : "is"} invalid.
      </>
    ),
    onResolve: () => removeItemsFromList(errorQrIds),
  };
}

/**
 * The archived-assets blocker. Resolving it drops the archived rows.
 *
 * @param archivedAssetIds - From {@link archivedAssetIdsOf}
 * @param removeAssetsFromList - Drops rows by asset id
 * @param description - What the drawer's action cannot do with them
 * @returns The blocker config, id `assets-archived`
 */
export function archivedAssetsBlocker(
  archivedAssetIds: string[],
  removeAssetsFromList: (assetIds: string[]) => void,
  description: string
): BlockerConfig {
  return {
    id: "assets-archived",
    condition: archivedAssetIds.length > 0,
    count: archivedAssetIds.length,
    message: (count: number) => (
      <>
        <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
        archived.
      </>
    ),
    description,
    onResolve: () => removeAssetsFromList(archivedAssetIds),
  };
}

/**
 * The blocker for kits holding only archived assets. Resolving it drops those
 * kits' rows by code.
 *
 * @param qrIds - Codes of the kits from {@link kitIdsWithOnlyArchivedAssetsOf}
 * @param removeItemsFromList - Drops rows by code
 * @param description - Why there is nothing in them for the drawer's action
 * @returns The blocker config, id `kits-only-archived`
 */
export function kitsOnlyArchivedBlocker(
  qrIds: string[],
  removeItemsFromList: (qrIds: string[]) => void,
  description: string
): BlockerConfig {
  return {
    id: "kits-only-archived",
    condition: qrIds.length > 0,
    count: qrIds.length,
    message: (count: number) => (
      <>
        <strong>{`${count} kit${count > 1 ? "s hold" : " holds"}`}</strong> only
        archived assets.
      </>
    ),
    description,
    onResolve: () => removeItemsFromList(qrIds),
  };
}
