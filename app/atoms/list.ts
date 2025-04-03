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
  null, // it's a convention to pass `null` for the first argument
  (_, set, update) => {
    set(selectedBulkItemsAtom, (prev) => {
      if (prev.includes(update)) {
        return prev.filter((item) => item !== update);
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

    set(selectedBulkItemsAtom, filteredUpdate);
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
