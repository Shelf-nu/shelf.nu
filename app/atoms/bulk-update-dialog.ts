import { atom } from "jotai";
import type { BulkDialogType } from "~/components/bulk-update-dialog/bulk-update-dialog";

/**
 * This atom is responsible for holding the open state for dialogs
 * Open Dialog must be open at a time
 */
export const bulkDialogAtom = atom<Record<BulkDialogType, boolean>>({
  location: false,
  category: false,
  "assign-custody": false,
  "release-custody": false,
  trash: false,
  archive: false,
  cancel: false,
});

/**
 * This will trigger the Dialog to open for a particular key
 */
export const openBulkDialogAtom = atom<null, BulkDialogType[], unknown>(
  null,
  (_, set, update) => {
    set(bulkDialogAtom, (prev) => ({ ...prev, [update]: true }));
  }
);

/**
 * This will trigger the Dialog to close for a particular key
 */

export const closeBulkDialogAtom = atom<null, BulkDialogType[], unknown>(
  null,
  (_, set, update) => {
    set(bulkDialogAtom, (prev) => ({ ...prev, [update]: false }));
  }
);
