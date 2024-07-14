import { atom } from "jotai";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";

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
