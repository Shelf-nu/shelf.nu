import { useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useLocation } from "react-router";
import { fileErrorAtom } from "./file";
import {
  clearSelectedBulkItemsAtom,
  selectionIsFormStateAtom,
  setDisabledBulkItemsAtom,
} from "./list";
import { clearScannedItemsAtom } from "./qr-scanner";

/**
 * Query-string keys that do not change which rows the selection was made from.
 *
 * `page` and `per_page` re-slice the same result set, and selecting across pages
 * is deliberate. `getAll` expands a filter dropdown's option list, `scanId` and
 * `redirectTo` carry navigation context. Deliberately separate from the
 * cookie-exclusion list in `~/hooks/search-params`: that list answers "should
 * this be persisted", which is a different question.
 */
const KEYS_THAT_KEEP_THE_RESULT_SET = [
  "page",
  "per_page",
  "getAll",
  "scanId",
  "redirectTo",
];

/**
 * The filter-bearing part of the query string: everything except
 * `KEYS_THAT_KEEP_THE_RESULT_SET`. Changing a search term, a filter or the sort
 * changes what the rows even are. Keys are sorted so writing the same params in
 * a different order is not a change.
 */
function filterSignature(search: string) {
  const filtered = new URLSearchParams(search);
  KEYS_THAT_KEEP_THE_RESULT_SET.forEach((key) => filtered.delete(key));
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
 * rather than from a `useEffect`. This matters because the `manage-*` pickers
 * initialize `selectedBulkItemsAtom` during their own render. Doing the reset here in a
 * `useEffect` would fire *after* those routes' init and silently blank the
 * selection, making already-attached items appear unchecked on revisit and
 * causing the manage-* form to mark them as removed on submit. Running during
 * render means this component (rendered as a sibling above the route) runs
 * its reset before the child route renders, so the route's init writes last
 * and wins.
 *
 * The selection is also cleared when the FILTER changes, not just the pathname.
 * A tick must not outlive the filter it was made under: once its row is off
 * screen the user can no longer see it, but a bulk action would still reach it.
 * Routes whose selection is form state rather than a set of rows to act on seed
 * it through `seedFormSelectionAtom` and are skipped.
 *
 * Reads `location.search` rather than a `useSearchParams` hook: the repo's
 * sanctioned wrapper is cookie-backed and reads asset-index loader data, which
 * this component cannot rely on because it is mounted in the layout above every
 * route. The raw string is all that is needed here.
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
