import { atom } from "jotai";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";

export type ScanListItems = {
  [key: string]: ScanListItem;
};

export type ScanListItem =
  | {
      data?: KitFromQr | AssetFromQr;
      error?: string;
      type?: "asset" | "kit";
      codeType?: "qr" | "barcode"; // Track whether this came from QR or barcode
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

/**
 * A derived atom that extracts asset and kit IDs from the scanned items
 * This avoids repeatedly filtering the items in different components
 *
 * @returns An object containing arrays of assetIds and kitIds
 */
export const scannedItemIdsAtom = atom((get) => {
  const items = get(scannedItemsAtom);

  // Extract asset IDs from items of type "asset"
  const assetIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data?.id);

  // Extract kit IDs from items of type "kit"
  const kitIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data?.id);

  return { assetIds, kitIds, idsTotalCount: assetIds.length + kitIds.length };
});

// Add item to object with value `undefined` (just receives the key)
export const addScannedItemAtom = atom(
  null,
  (get, set, qrId: string, error?: string, codeType?: "qr" | "barcode") => {
    const currentItems = get(scannedItemsAtom);
    if (!currentItems[qrId]) {
      /** Set can optionally receive error. If it does, add it to the item.
       * This is used for errors that are related to the QR code itself, not the item.
       */
      set(scannedItemsAtom, {
        [qrId]: error
          ? {
              error: error,
              codeType,
            }
          : {
              codeType,
            }, // Add the new entry at the start
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

    // Check if the item already exists with data; if it does, skip the update
    // Allow updates if the current item doesn't have data (just codeType or undefined)
    const currentItem = currentItems[qrId];
    if (!item || (currentItem && currentItem.data)) {
      return; // Skip the update if the item is already present with data
    }

    // Check for duplicate assets/kits by ID before adding
    if (item && item.data && item.type) {
      const assetOrKitId = item.data.id;
      
      // Look for existing items with the same asset/kit ID
      const existingDuplicateKey = Object.entries(currentItems).find(([key, existingItem]) => {
        if (key === qrId) return false; // Don't compare with self
        return existingItem?.data?.id === assetOrKitId && existingItem?.type === item.type;
      });

      if (existingDuplicateKey) {
        console.log(`🚫 Duplicate ${item.type} detected:`, {
          newKey: qrId,
          existingKey: existingDuplicateKey[0],
          assetOrKitId
        });
        
        // Add the duplicate with an error message instead of blocking silently
        const duplicateItem: ScanListItem = {
          error: `This ${item.type} is already in the list.`,
          codeType: item.codeType,
        };
        
        set(scannedItemsAtom, {
          ...currentItems,
          [qrId]: duplicateItem,
        });
        return;
      }
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
