import { atom } from "jotai";

export const selectedBulkItemsAtom = atom<string[]>([]);

/* This atom is used to keep track of the number of selected items */
export const selectedBulkItemsCountAtom = atom(
  (get) => get(selectedBulkItemsAtom).length
);
