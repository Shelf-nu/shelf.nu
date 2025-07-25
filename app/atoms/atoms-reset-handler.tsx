import { useEffect } from "react";
import { useLocation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { fileErrorAtom } from "./file";
import { setDisabledBulkItemsAtom, setSelectedBulkItemsAtom } from "./list";
import { clearScannedItemsAtom } from "./qr-scanner";

/**
 * Reset atoms when the route changes
 * This is an app level component used in _layout.tsx file
 * Due to certain limitations the onMount approach used with selectedBulkItemsAtom doesnt work, so we need to use this approach
 * Resets multiple atoms to prevent state persistence across different contexts:
 * - selectedBulkItemsAtom: Clear bulk selection when navigating
 * - scannedItemsAtom: Clear scanned QR/barcode items when switching scanners or contexts
 * - fileErrorAtom: Clear file upload errors
 */
export function AtomsResetHandler() {
  const location = useLocation();
  const resetDisabledItems = useSetAtom(setDisabledBulkItemsAtom);
  const resetSelectedItems = useSetAtom(setSelectedBulkItemsAtom);
  const resetFileAtom = useSetAtom(fileErrorAtom);
  const resetScannedItems = useSetAtom(clearScannedItemsAtom);

  useEffect(() => {
    // Reset when the route changes
    resetDisabledItems([]);
    resetSelectedItems([]);
    resetFileAtom(undefined);
    resetScannedItems();
  }, [
    location.pathname,
    resetDisabledItems,
    resetFileAtom,
    resetSelectedItems,
    resetScannedItems,
  ]);

  return null;
}
