import { useRef } from "react";
import { useSetAtom } from "jotai";
import { useLocation } from "react-router";
import { fileErrorAtom } from "./file";
import { clearSelectedBulkItemsAtom, setDisabledBulkItemsAtom } from "./list";
import { clearScannedItemsAtom } from "./qr-scanner";

/**
 * Reset atoms when the route changes.
 *
 * Mounted at the top of `_layout+/_layout.tsx`. Resets multiple atoms to
 * prevent state persistence across different contexts:
 * - `selectedBulkItemsAtom`: Clear bulk selection when navigating
 * - `disabledBulkItemsAtom`: Clear disabled-item list when navigating
 * - `scannedItemsAtom`: Clear scanned QR/barcode items when switching scanners
 * - `fileErrorAtom`: Clear file upload errors
 *
 * The reset runs synchronously during render (guarded by a pathname ref)
 * rather than from a `useEffect`. This matters because some routes — namely
 * `bookings.$bookingId.overview.manage-{kits,assets}` — initialize
 * `selectedBulkItemsAtom` during their own render. Doing the reset here in a
 * `useEffect` would fire *after* those routes' init and silently blank the
 * selection, making already-attached items appear unchecked on revisit and
 * causing the manage-* form to mark them as removed on submit. Running during
 * render means this component (rendered as a sibling above the route) runs
 * its reset before the child route renders, so the route's init writes last
 * and wins.
 */
export function AtomsResetHandler() {
  const location = useLocation();
  const resetDisabledItems = useSetAtom(setDisabledBulkItemsAtom);
  const resetSelectedItems = useSetAtom(clearSelectedBulkItemsAtom);
  const resetFileAtom = useSetAtom(fileErrorAtom);
  const resetScannedItems = useSetAtom(clearScannedItemsAtom);

  const lastPathnameRef = useRef<string | undefined>(undefined);
  if (lastPathnameRef.current !== location.pathname) {
    lastPathnameRef.current = location.pathname;
    resetDisabledItems([]);
    resetSelectedItems();
    resetFileAtom(undefined);
    resetScannedItems();
  }

  return null;
}
