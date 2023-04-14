import type React from "react";
import { atom } from "jotai";

/** Controls the state for the selected categories for cateogry dropdown.
 * The dropdown is used when filtering index */
export const selectedCategoriesAtom = atom<string[]>([]);

/** Called to set the initial state.
 * We need this atom because the inital state gets loaded from the url params
 */
export const addInitialSelectedCategoriesAtom = atom(
  null,
  (_get, set, selected: string[]) => {
    set(selectedCategoriesAtom, selected);
  }
);

/** Updates the selected categories by merging the state */
export const addOrRemoveSelectedIdAtom = atom(
  null,
  (_get, set, event: React.ChangeEvent<HTMLInputElement>) => {
    set(selectedCategoriesAtom, (prev) => {
      // event.preventDefault();
      const node = event.target as HTMLInputElement;
      const id = node.value satisfies string;
      const newSelected = prev.includes(id)
        ? prev.filter((string) => string !== id)
        : [...prev, id];
      return newSelected;
    });
  }
);

/** Flag to control weather the user has touched the category filter */
export const isFilteringCategoriesAtom = atom(false);
