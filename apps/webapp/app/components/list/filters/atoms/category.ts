import type { ChangeEvent } from "react";
import { atom } from "jotai";

/** Controls the state for the selected categories for cateogry dropdown.
 * The dropdown is used when filtering index */
export const selectedCategoriesAtom = atom<{
  isFiltering: boolean;
  items: string[];
}>({
  isFiltering: false,
  items: [],
});

/** Called to set the initial state.
 * We need this atom because the inital state gets loaded from the url params
 */
export const addInitialSelectedCategoriesAtom = atom(
  null,
  (_get, set, selected: string[]) => {
    set(selectedCategoriesAtom, (prev) => ({
      ...prev,
      items: selected,
    }));
  }
);

/** Updates the selected categories by merging the state */
export const addOrRemoveSelectedCategoryIdAtom = atom(
  null,
  (_get, set, event: ChangeEvent<HTMLInputElement>) => {
    set(selectedCategoriesAtom, (prev) => {
      const node = event.target as HTMLInputElement;
      const id = node.value satisfies string;
      const newSelected = prev.items.includes(id)
        ? prev.items.filter((string) => string !== id)
        : [...prev.items, id];
      return { isFiltering: true, items: newSelected };
    });
  }
);

/** Flag to control weather the user has touched the category filter.
 * Gets set to true when the category is clicked
 * Gets set to false as a callback of the form submit
 * */
export const toggleIsFilteringCategoriesAtom = atom(
  (get) => get(selectedCategoriesAtom).isFiltering,
  (get, set) => {
    set(selectedCategoriesAtom, (prev) => ({
      ...prev,
      isFiltering: !get(selectedCategoriesAtom),
    }));
  }
);

/** Clears the items. */
export const clearCategoryFiltersAtom = atom(null, (_get, set) =>
  set(selectedCategoriesAtom, { isFiltering: true, items: [] })
);
