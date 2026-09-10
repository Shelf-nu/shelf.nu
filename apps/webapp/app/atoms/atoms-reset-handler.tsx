import { useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useLocation } from "react-router";
import { SEARCH_PARAMS_KEYS_TO_EXCLUDE } from "~/hooks/search-params";
import { fileErrorAtom } from "./file";
import {
  clearSelectedBulkItemsAtom,
  selectionIsFormStateAtom,
  setDisabledBulkItemsAtom,
} from "./list";
import { clearScannedItemsAtom } from "./qr-scanner";

/**
 * Reads `location.search` rather than a `useSearchParams` hook: the repo's
 * sanctioned wrapper is cookie-backed and reads asset-index loader data, which
 * this component cannot rely on because it is mounted in the layout above every
 * route. The raw string is all that is needed here.
 *
 * The filter-bearing part of the query string: everything except the keys that
 * change WHICH PAGE of the same result set you are looking at. Paging must not
 * clear a selection, because selecting across pages is deliberate. Changing a
 * search term, a filter or the sort changes what the rows even are.
 */
function filterSignature(search: string) {
  const filtered = new URLSearchParams(search);
  SEARCH_PARAMS_KEYS_TO_EXCLUDE.forEach((key) => filtered.delete(key));
  filtered.sort();
  return filtered.toString();
}

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
 *
 * The selection is also cleared when the FILTER changes, not just the pathname.
 * A tick made before a search stayed selected while its row was off screen, and
 * the next bulk action reached an asset the user could no longer see — that is
 * how an Aputure Amaran ended up linked to a "Stream Deck XL" asset model
 * nobody chose. Routes whose selection is form state rather than a set of rows
 * to act on set `selectionIsFormStateAtom` and are skipped.
 */
export function AtomsResetHandler() {
  const location = useLocation();
  const resetDisabledItems = useSetAtom(setDisabledBulkItemsAtom);
  const resetSelectedItems = useSetAtom(clearSelectedBulkItemsAtom);
  const resetFileAtom = useSetAtom(fileErrorAtom);
  const resetScannedItems = useSetAtom(clearScannedItemsAtom);
  const setSelectionIsFormState = useSetAtom(selectionIsFormStateAtom);
  const selectionIsFormState = useAtomValue(selectionIsFormStateAtom);

  const lastPathnameRef = useRef<string | undefined>(undefined);
  const lastFilterRef = useRef<string | undefined>(undefined);
  const nextFilter = filterSignature(location.search);

  if (lastPathnameRef.current !== location.pathname) {
    lastPathnameRef.current = location.pathname;
    lastFilterRef.current = nextFilter;
    resetDisabledItems([]);
    resetSelectedItems();
    resetFileAtom(undefined);
    resetScannedItems();
    // A route that opted out does so during ITS render, which happens after
    // this one. Clearing the flag here means an opt-out cannot outlive the
    // route that asked for it.
    setSelectionIsFormState(false);
  } else if (lastFilterRef.current !== nextFilter) {
    lastFilterRef.current = nextFilter;
    // Same page, different rows. Only the selection is stale: the scanned
    // items and the file error belong to the page, not to the filter.
    if (!selectionIsFormState) {
      resetSelectedItems();
    }
  }

  return null;
}
