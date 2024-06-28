import { atom } from "jotai";

/** This atom will keep track of BulkLocationUpdateDialog open state  */
export const bulkLocationUpdateDialogOpenAtom = atom(false);

/** Close the dialog */
export const closeBulkUpdateLocationDialogAtom = atom(null, (_, set) => {
  set(bulkLocationUpdateDialogOpenAtom, false);
});

/** Open the dialog */
export const openBulkUpdateLocationDialogAtom = atom(null, (_, set) => {
  set(bulkLocationUpdateDialogOpenAtom, true);
});
