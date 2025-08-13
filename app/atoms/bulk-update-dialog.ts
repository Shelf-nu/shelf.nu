import { atom } from "jotai";
import type { BulkDialogType } from "~/components/bulk-update-dialog/bulk-update-dialog";

/**
 * This atom is responsible for holding the open state for dialogs
 * Open Dialog must be open at a time
 */
const DEFAULT_STATE: Record<BulkDialogType, boolean> = {
  location: false,
  category: false,
  "assign-custody": false,
  "release-custody": false,
  "tag-add": false,
  "tag-remove": false,
  trash: false,
  activate: false,
  deactivate: false,
  archive: false,
  cancel: false,
  available: false,
  unavailable: false,
  bookings: false,
  "booking-exist": false,
  "download-qr": false,
  "partial-checkin": false,
};

export const bulkDialogAtom =
  atom<Record<BulkDialogType, boolean>>(DEFAULT_STATE);

/** Reset the atom when it mounts */
bulkDialogAtom.onMount = (setAtom) => {
  setAtom(DEFAULT_STATE);
};

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
