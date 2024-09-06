import { atom } from "jotai";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";

export type ScanListItems = {
  [key: string]: ScanListItem;
};

export type ScanListItem =
  | {
      data?: AssetWithBooking | KitForBooking;
      error?: string;
      type?: "asset" | "kit";
    }
  | undefined;

/***********************
 * Scanned QR Id Atom  *
 *
 * The data is structured in a object where:
 * - key: qrId
 * - value: asset
 *
 ***********************/

export const scannedItemsAtom = atom<ScanListItems>({});

/** Get an array of the scanned items ids */
export const scannedItemsIdsAtom = atom((get) =>
  Object.values(get(scannedItemsAtom)).map((item) => item?.data?.id)
);

// Add item to object with value `undefined` (just receives the key)
export const addScannedItemAtom = atom(
  null,
  (get, set, qrId: string, error?: string) => {
    const currentItems = get(scannedItemsAtom);
    if (!currentItems[qrId]) {
      /** Set can optionally receive error. If it does, add it to the item.
       * This is used for errors that are related to the QR code itself, not the item.
       */
      set(scannedItemsAtom, {
        [qrId]: error
          ? {
              error: error,
            }
          : undefined, // Add the new entry at the start
        ...currentItems, // Spread the rest of the existing items
      });
    }
  }
);

// Update item based on key
export const updateScannedItemAtom = atom(
  null,
  (get, set, { qrId, item }: { qrId: string; item: ScanListItem }) => {
    const currentItems = get(scannedItemsAtom);

    // Check if the item already exists; if it does, skip the update
    if (!item || currentItems[qrId]) {
      return; // Skip the update if the item is already present
    }

    if ((item && item?.data && item?.type) || item?.error) {
      set(scannedItemsAtom, {
        ...currentItems,
        [qrId]: item,
      });
    }
  }
);

// Remove item based on key
export const removeScannedItemAtom = atom(null, (get, set, qrId: string) => {
  const currentItems = get(scannedItemsAtom);
  const { [qrId]: _, ...rest } = currentItems; // Removes the key
  set(scannedItemsAtom, rest);
});

// Remove multiple items based on key array
export const removeMultipleScannedItemsAtom = atom(
  null,
  (get, set, qrIds: string[]) => {
    const currentItems = get(scannedItemsAtom);
    const updatedItems = { ...currentItems };
    qrIds.forEach((qrId) => {
      delete updatedItems[qrId];
    });
    set(scannedItemsAtom, updatedItems);
  }
);

// Remove items based on asset id
export const removeScannedItemsByAssetIdAtom = atom(
  null,
  (get, set, ids: string[]) => {
    const currentItems = get(scannedItemsAtom);
    const updatedItems = { ...currentItems };
    Object.entries(currentItems).forEach(([qrId, item]) => {
      if (item?.data?.id && ids.includes(item?.data?.id)) {
        delete updatedItems[qrId];
      }
    });
    set(scannedItemsAtom, updatedItems);
  }
);

// Clear all items
export const clearScannedItemsAtom = atom(null, (_get, set) => {
  set(scannedItemsAtom, {}); // Resets the atom to an empty object
});

/*******************************/
