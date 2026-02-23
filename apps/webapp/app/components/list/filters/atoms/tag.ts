import type { ChangeEvent } from "react";
import { atom } from "jotai";

/** Controls the state for the selected tags for tag dropdown.
 * The dropdown is used when filtering index */
export const selectedTagsAtom = atom<{
  isFiltering: boolean;
  items: string[];
}>({
  isFiltering: false,
  items: [],
});

/** Called to set the initial state.
 * We need this atom because the inital state gets loaded from the url params
 */
export const addInitialSelectedTagsAtom = atom(
  null,
  (_get, set, selected: string[]) => {
    set(selectedTagsAtom, (prev) => ({
      ...prev,
      items: selected,
    }));
  }
);

/** Updates the selected tags by merging the state */
export const addOrRemoveSelectedTagIdAtom = atom(
  null,
  (_get, set, event: ChangeEvent<HTMLInputElement>) => {
    set(selectedTagsAtom, (prev) => {
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
export const toggleIsFilteringTagsAtom = atom(
  (get) => get(selectedTagsAtom).isFiltering,
  (get, set) => {
    set(selectedTagsAtom, (prev) => ({
      ...prev,
      isFiltering: !get(selectedTagsAtom),
    }));
  }
);

/** Clears the items. */
export const clearTagFiltersAtom = atom(null, (_get, set) =>
  set(selectedTagsAtom, { isFiltering: true, items: [] })
);
