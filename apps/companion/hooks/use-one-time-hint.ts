/**
 * useOneTimeHint — AsyncStorage-backed state for a discoverability hint that
 * should appear once and then never again.
 *
 * Extracted from the scanner's action-pills coachmark so every "show this tip
 * until the user gets it" surface stores its flag the same way: one versioned
 * key, storage failures degrade to "already seen" (a hint must never block the
 * screen it sits on), and nothing renders until storage has been read so the
 * bubble can't flash in and out.
 *
 * @see {@link file://../components/scanner/action-pills-coachmark.tsx}
 * @see {@link file://../components/audit/evidence-coachmark.tsx}
 */
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type OneTimeHint = {
  /**
   * True only when storage has been read AND the hint has not been dismissed.
   * Render the hint on this — never on `!dismissed`, which would flash the
   * bubble before storage resolves.
   */
  shouldShow: boolean;
  /** Hides the hint now and persists the dismissal (best effort). */
  dismiss: () => void;
};

/**
 * @param storageKey Versioned AsyncStorage key — bump the version suffix to
 *   re-show the hint after a redesign.
 * @param enabled When false the hint never shows, but storage is still read so
 *   flipping this later doesn't cause a flash.
 */
export function useOneTimeHint(
  storageKey: string,
  enabled: boolean = true
): OneTimeHint {
  // null = storage not read yet (render nothing to avoid a flash)
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (!cancelled) setDismissed(value === "1");
      })
      .catch(() => {
        // why: storage failure should never block the surface the hint sits
        // on — treat it as already seen
        if (!cancelled) setDismissed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(storageKey, "1").catch(() => {
      // why: best-effort persistence; worst case the hint shows once more
    });
  }, [storageKey]);

  return { shouldShow: enabled && dismissed === false, dismiss };
}
