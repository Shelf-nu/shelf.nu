/**
 * Blocker list for the "Scan to Assign" drawer, which adds scanned assets and
 * kits to a booking.
 *
 * Derived here, as a pure function of the scanned rows and the booking, so
 * `booking-scan-blockers.test.tsx` can pin every blocker by its `id`. A drawer
 * component is impractical to mount in a test, and a blocker that never fires
 * lets a row through that the server then refuses, taking the whole batch with
 * it.
 *
 * @see {@link file://./add-assets-to-booking-drawer.tsx}
 * @see {@link file://./../blockers-factory.tsx} renders what this returns
 */

import { AssetStatus, AssetType, KitStatus } from "@prisma/client";
import type { BookingStatus } from "@prisma/client";
import type { ScanListItems } from "~/atoms/qr-scanner";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";
import type { BlockerConfig } from "../blockers-factory";
import {
  archivedAssetIdsOf,
  archivedAssetsBlocker,
  assetsOf,
  errorQrIdsOf,
  invalidCodesBlocker,
  kitHasUnavailableActiveMember,
  kitIdsWithOnlyArchivedAssetsOf,
  kitsOf,
  kitsOnlyArchivedBlocker,
  qrIdsForKitIds,
} from "./scan-blocker-helpers";
import type { ScanBlockerRemovers, ScanBlockers } from "./scan-blocker-helpers";

/** What the booking drawer hands its builder. */
export type AddToBookingBlockerArgs = ScanBlockerRemovers & {
  /** The scanned rows, keyed by the code that resolved them. */
  items: ScanListItems;
  /** The booking being added to, as the route loaded it. */
  booking: {
    status: BookingStatus;
    bookingAssets: { assetId: string }[];
  };
  /**
   * Asset ids the reservation matcher credited against an outstanding reserved
   * unit. They are already on the booking, and scanning them is how they come
   * to answer the reservation, so they are not duplicates.
   */
  claimedAssetIds: ReadonlySet<string>;
};

/**
 * Free units this booking may still draw on for a scanned row, or `null` when
 * the question doesn't apply because the row is an INDIVIDUAL asset.
 *
 * `pickerMeta.maxAllowed` is the booking's pool for this asset, resolved
 * server-side by the same primitive the write guard enforces with, so a row
 * judged here agrees with what the submit will do. It is absent only when a
 * scan carried no picker context; the asset's own stock is the closest stand-in
 * then, and a quantity-tracked row with no recorded stock has nothing to stage.
 *
 * Shared by the blocker list and the row badge so the two can never disagree
 * about which rows are exhausted: a blocker whose row shows no badge is a count
 * the user cannot attribute to anything.
 *
 * @param asset - A scanned asset
 * @returns Units available to this booking, or `null` for INDIVIDUAL assets
 */
export function resolveScannedUnitsAvailable(
  asset: AssetFromQr
): number | null {
  if (!isQuantityTracked(asset)) return null;
  return asset.pickerMeta?.maxAllowed ?? asset.quantity ?? 0;
}

/** Whether the booking is out, which is when checked-out items conflict. */
function bookingIsCheckedOut(status: BookingStatus): boolean {
  return status === "ONGOING" || status === "OVERDUE";
}

/**
 * Blockers for the add-assets-to-booking drawer.
 *
 * The checked-out blocker is scoped to INDIVIDUAL assets: `Asset.status` is one
 * flag for the whole row, so a quantity-tracked pool reads CHECKED_OUT while one
 * unit is out and the rest is free stock. Quantity rows are judged on their own
 * free pool by `qty-no-units` instead.
 *
 * A kit with SOME archived members is booked with its active ones, so only a
 * kit whose every member is archived blocks.
 *
 * @param args - The scanned rows, the booking, the matcher's claimed ids and
 *   the removers
 * @returns The blocker configs, in display order
 */
export function buildAddToBookingBlockers({
  items,
  booking,
  claimedAssetIds,
  removeAssetsFromList,
  removeItemsFromList,
}: AddToBookingBlockerArgs): ScanBlockers {
  const assets = assetsOf(items);
  const kits = kitsOf(items);
  const errorQrIds = errorQrIdsOf(items);
  const bookingIsOut = bookingIsCheckedOut(booking.status);
  const isOnBooking = (assetId: string) =>
    booking.bookingAssets.some((ba) => ba.assetId === assetId);

  // A scan the matcher put in the `claimed` bucket is already on the booking by
  // definition, and submitting it is what claims the reserved unit. This must
  // be the matcher's verdict rather than structural eligibility: on a booking
  // with no reservations every already-added asset is structurally claimable,
  // so exempting on that would disable this blocker for the ordinary case.
  const assetsAlreadyAddedIds = assets
    .filter((asset) => isOnBooking(asset.id) && !claimedAssetIds.has(asset.id))
    .map((asset) => asset.id);

  // Only an INDIVIDUAL asset in a kit is a "scan the kit QR instead" case. A
  // quantity-tracked asset has only a slice of its pool in any kit, and the
  // free remainder is bookable on its own.
  const assetsPartOfKitIds = assets
    .filter(
      (asset) =>
        asset.type === AssetType.INDIVIDUAL && asset.assetKits.length > 0
    )
    .map((asset) => asset.id);

  const unavailableAssetsIds = assets
    .filter((asset) => !asset.availableToBook)
    .map((asset) => asset.id);

  const qrIdsOfKitsWithUnavailableAssets = qrIdsForKitIds(
    items,
    kits.filter(kitHasUnavailableActiveMember).map((kit) => kit.id)
  );

  const checkedOutAssetsIds = assets
    .filter(
      (asset) =>
        asset.type === AssetType.INDIVIDUAL &&
        asset.status === AssetStatus.CHECKED_OUT
    )
    .map((asset) => asset.id);

  // Quantity rows with nothing left to stage. At zero the row renders no qty
  // input and the server would reject it. Rows already on the booking are
  // exempt: the scan is a no-op for them, and their badge says so.
  const noUnitsAvailableIds = assets
    .filter((asset) => {
      const unitsAvailable = resolveScannedUnitsAvailable(asset);
      return (
        unitsAvailable !== null && unitsAvailable <= 0 && !isOnBooking(asset.id)
      );
    })
    .map((asset) => asset.id);

  const qrIdsOfCheckedOutKits = qrIdsForKitIds(
    items,
    kits
      .filter((kit) => kit.status === KitStatus.CHECKED_OUT)
      .map((kit) => kit.id)
  );

  const archivedAssetIds = archivedAssetIdsOf(assets);
  const qrIdsOfKitsOnlyArchived = qrIdsForKitIds(
    items,
    kitIdsWithOnlyArchivedAssetsOf(kits)
  );

  const blockerConfigs: BlockerConfig[] = [
    {
      id: "assets-checked-out",
      condition: bookingIsOut && checkedOutAssetsIds.length > 0,
      count: checkedOutAssetsIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already checked out.
        </>
      ),
      onResolve: () => removeAssetsFromList(checkedOutAssetsIds),
    },
    {
      id: "qty-no-units",
      condition: noUnitsAvailableIds.length > 0,
      count: noUnitsAvailableIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s have" : " has"}`}</strong> no
          units available.
        </>
      ),
      onResolve: () => removeAssetsFromList(noUnitsAvailableIds),
    },
    {
      id: "kits-checked-out",
      condition: bookingIsOut && qrIdsOfCheckedOutKits.length > 0,
      count: qrIdsOfCheckedOutKits.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already checked out.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfCheckedOutKits),
    },
    {
      id: "assets-unavailable",
      condition: unavailableAssetsIds.length > 0,
      count: unavailableAssetsIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          marked as <strong>unavailable</strong>.
        </>
      ),
      onResolve: () => removeAssetsFromList(unavailableAssetsIds),
    },
    {
      id: "assets-already-added",
      condition: assetsAlreadyAddedIds.length > 0,
      count: assetsAlreadyAddedIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""}`}</strong> already
          added to the booking.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyAddedIds),
    },
    {
      id: "assets-part-of-kit",
      condition: assetsPartOfKitIds.length > 0,
      count: assetsPartOfKitIds.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong> are part
          of a kit.
        </>
      ),
      description:
        "Note: Scan the kit QR to add them. The kit fulfils any reserved units its assets cover.",
      onResolve: () => removeAssetsFromList(assetsPartOfKitIds),
    },
    {
      id: "kits-with-unavailable-assets",
      condition: qrIdsOfKitsWithUnavailableAssets.length > 0,
      count: qrIdsOfKitsWithUnavailableAssets.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s have" : " has"} `}</strong>{" "}
          unavailable assets inside {count > 1 ? "them" : "it"}.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsWithUnavailableAssets),
    },
    archivedAssetsBlocker(
      archivedAssetIds,
      removeAssetsFromList,
      "Archived assets can't be added to a booking."
    ),
    kitsOnlyArchivedBlocker(
      qrIdsOfKitsOnlyArchived,
      removeItemsFromList,
      "There is nothing in them to book."
    ),
    invalidCodesBlocker(errorQrIds, removeItemsFromList),
  ];

  return { blockerConfigs };
}
