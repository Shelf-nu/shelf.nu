import { atom } from "jotai";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import { ShelfError } from "~/utils/error";
import { scannedQrIdsAtom } from "./qr-scanner";

/** This atom keeps track of the assets fetched after scanning.  */
export const fetchedScannedAssetsAtom = atom<AssetWithBooking[]>([]);

/** This atom keeps track of the total fetchedScanned assets */
export const fetchedScannedAssetsCountAtom = atom(
  (get) => get(fetchedScannedAssetsAtom).length
);

/**
 * This atom is used to set multiple assets into fetchedScannedAssetAtom.
 * This will replace new items with existing ones.
 * */
export const setFetchedScannedAssetsAtom = atom<
  null,
  AssetWithBooking[][],
  unknown
>(null, (_, set, update) => {
  set(fetchedScannedAssetsAtom, update);
});

/**
 * This atom is used to set a single asset into fetchedScannedAssetAtom
 * If `update` asset is already added then it will not be added again in the array.
 * */
export const setFetchedScannedAssetAtom = atom<
  null,
  AssetWithBooking[],
  unknown
>(null, (_, set, update) => {
  set(fetchedScannedAssetsAtom, (prev) => [
    ...prev,
    ...(prev.some((a) => a.id === update.id) ? [] : [update]),
  ]);
});

/**
 * This atom is used to remove an asset from the list using the `id` of asset.
 */
export const removeFetchedScannedAssetAtom = atom<null, string[], unknown>(
  null,
  (get, set, update) => {
    const removedAsset = get(fetchedScannedAssetsAtom).find(
      (asset) => asset.id === update
    );

    /** This case should not happen */
    if (!removedAsset) {
      throw new ShelfError({
        cause: null,
        message: "Asset not found",
        label: "Booking",
      });
    }

    set(fetchedScannedAssetsAtom, (prev) =>
      prev.filter((asset) => asset.id !== update)
    );

    /** If an asset is removed from the list then we also have to remove the qr of that asset, so user can refetch it  */
    set(scannedQrIdsAtom, (prev) =>
      prev.filter((qr) => qr !== removedAsset.qrScanned)
    );
  }
);

/** This atom clears all the items in fetchedScannedAssetsAtom */
export const clearFetchedScannedAssetsAtom = atom(null, (_, set) => {
  set(fetchedScannedAssetsAtom, []);

  // If we are clearing the atom from list then we also have to remove scanned qrIds so that user can scan them again
  set(scannedQrIdsAtom, []);
});
