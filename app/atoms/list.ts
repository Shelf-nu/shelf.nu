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
export const selectedBulkItemsCountAtom = atom(
  (get) => get(selectedBulkItemsAtom).length
);

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

    // Filter out disabled items from the update
    const filteredUpdate = update.filter(
      (item) =>
        !disabledItems.some((disabledItem) => disabledItem.id === item.id)
    );

    /* We have to remove the existing and add new ones */
    set(selectedBulkItemsAtom, (prev) => {
      /** If filteredUpdate is empty, that means that user is unselecting all items */
      if (filteredUpdate.length === 0) {
        return [];
      }

      const existingItems = prev.filter((item) =>
        filteredUpdate.some((updatedItem) => updatedItem.id === item.id)
      );

      // /** Remove if there are any existing */
      if (existingItems.length > 0) {
        return prev.filter(
          (item) =>
            !existingItems.some((updatedItem) => updatedItem.id === item.id)
        );
      }

      /* Add the new items from the update */
      return [...prev, ...filteredUpdate];
    });
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
