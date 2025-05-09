import { useEffect } from "react";
import { useLocation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { fileErrorAtom } from "./file";
import { setDisabledBulkItemsAtom, setSelectedBulkItemsAtom } from "./list";

/**
 * Reset the atom when it mounts
 * This is an app level component.
 * Due to certain limitations the onMount approach used with selectedBulkItemsAtom doesnt work, so we need to use this approach
 * I think this is actually better in a way, so we could use this to reset other atoms as well in the future
 * This is used to reset the selectedBulkItemsAtom when the route changes
 * This is used in the _layout.tsx file
 */
export function AtomsResetHandler() {
  const location = useLocation();
  const resetDisabledItems = useSetAtom(setDisabledBulkItemsAtom);
  const resetSelectedItems = useSetAtom(setSelectedBulkItemsAtom);
  const resetFileAttom = useSetAtom(fileErrorAtom);

  useEffect(() => {
    // Reset when the route changes
    resetDisabledItems([]);
    resetSelectedItems([]);
    resetFileAttom(undefined);
  }, [
    location.pathname,
    resetDisabledItems,
    resetFileAttom,
    resetSelectedItems,
  ]);

  return null;
}
