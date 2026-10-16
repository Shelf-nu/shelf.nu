/**
 * Discard-by-remount for create and edit forms.
 *
 * Form widgets keep their values in React state (tags, barcodes, image
 * picks, selects), so they cannot be reset field by field. A form wrapper
 * keys its inner form with `key` from this hook; `discard` bumps it and the
 * whole form remounts with the loaded values.
 *
 * @see {@link file://./use-unsaved-changes.ts}
 */
import { useCallback, useState } from "react";
import { useSetAtom } from "jotai";
import { useLocation, useNavigate } from "react-router";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

/**
 * Returns a remount key for a form and the `discard` that bumps it.
 *
 * `discard` also clears the page title that mirrors the Name field, and
 * puts back the query string the form was opened with when a picker
 * rewrote it (picking an asset model sets `?category=`).
 *
 * @returns `key` for the inner form and `discard` to pass as its `onDiscard`
 */
export function useDiscardRemount() {
  const [epoch, setEpoch] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const [initialSearch] = useState(location.search);
  const setDynamicTitle = useSetAtom(dynamicTitleAtom);

  const discard = useCallback(() => {
    setDynamicTitle("");
    const remount = () => setEpoch((e) => e + 1);
    if (location.search === initialSearch) return remount();
    // why: remount only once the loader has returned the original values,
    // or the fresh form would seed itself from the rewritten query string
    void Promise.resolve(
      navigate(
        { search: initialSearch },
        { replace: true, preventScrollReset: true }
      )
    ).then(remount);
  }, [initialSearch, location.search, navigate, setDynamicTitle]);

  return { key: epoch, discard };
}
