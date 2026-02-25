import { atom } from "jotai";
import type { ListItemData } from "~/components/list/list-item";

export const selectedBulkItemsAtom = atom<ListItemData[]>([]);

// This atom is used to keep track of the items that are disabled in the bulk actions
export const disabledBulkItemsAtom = atom<ListItemData[]>([]);

/**
 * Reset the atom when it mounts
 * This item is also reset in the atoms-reset-handler.tsx file
 * This is just in case the atom is used in a component that does not change route
 * */
selectedBulkItemsAtom.onMount = (setAtom) => {
  setAtom([]);
};

/* This atom is used to keep track of the number of selected items */
export const selectedBulkItemsCountAtom = atom((get) => {
  const selectedItems = get(selectedBulkItemsAtom);
  const kits = selectedItems.filter((i) => "_count" in i);
  const kitIds = kits.map((kit) => kit.id);

  const count = selectedItems.filter((item) => {
    if ("_count" in item) return true; // count kits
    if (!item.kitId) return true; // count assets without a kit
    if (item.kitId && !kitIds.includes(item.kitId)) return true; // count assets with a kit that's not selected
    return false;
  }).length;

  return count;
});
/**
 * Set an item in selectedBulkItems
 */
export const setSelectedBulkItemAtom = atom<null, ListItemData[], unknown>(
  null,
  (_, set, update) => {
    set(selectedBulkItemsAtom, (prev) => {
      // Check if the item exists by ID instead of reference
      const exists = prev.some((item) => item.id === update.id);

      if (exists) {
        // Remove by ID instead of reference
        return prev.filter((item) => item.id !== update.id);
      }
      return [...prev, update];
    });
  }
);

/**
 * Set multiple items at once in selectedBulkItems
 */
export const setSelectedBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (get, set, update) => {
    const disabledItems = get(disabledBulkItemsAtom);
    const prevItems = get(selectedBulkItemsAtom);

    // Filter out disabled items from the update
    const filteredUpdate = update.filter(
      (item) =>
        !disabledItems.some((disabledItem) => disabledItem.id === item.id)
    );

    // Create a map of previous items
    const prevItemsMap = new Map(prevItems.map((item) => [item.id, item]));

    // Merge with previous items
    filteredUpdate.forEach((item) => {
      prevItemsMap.set(item.id, item);
    });

    set(selectedBulkItemsAtom, Array.from(prevItemsMap.values()));
  }
);

/**
 * Set multiple items at once in disabledBulkItems
 * This is used to disable items in the bulk actions
 */
export const setDisabledBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (_, set, update) => {
    set(disabledBulkItemsAtom, update);
  }
);

/**
 * Remove the items from selectedBulkItemsAtom
 */
export const removeSelectedBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (_, set, update) => {
    set(selectedBulkItemsAtom, (prev) =>
      prev.filter(
        (prevItem) =>
          !update.some((updateItem) => updateItem.id === prevItem.id)
      )
    );
  }
);

/**
 * Clears selected bulk items
 */
export const clearSelectedBulkItemsAtom = atom<null, [], void>(
  null,
  (_, set) => {
    set(selectedBulkItemsAtom, []);
  }
);
