/**
 * Global progress bar
 *
 * Drives the NProgress bar at the top of the page from route navigation and
 * from fetchers. A fetcher whose UI shows its own feedback (an optimistic
 * update, a spinner of its own) is excluded, so the bar does not flash on top
 * of it.
 */
import { useMemo, useEffect } from "react";
import NProgress from "nprogress";
import { useNavigation, useFetchers } from "react-router";

/** Fetcher keys that never move the progress bar. */
const excludeFetchers = [
  "asset-index-settings-show-image",
  "asset-index-settings-freeze-column",
  "updates-change",
  "add-note",
  "add-user-note",
  "add-audit-note",
  "audit-scan-persist",
  "archive-audit",
  "cancel-audit",
  "sidebar-toggler",
  "team-upgrade-banner",
];

/** Prefixes of per-item fetcher keys that never move the progress bar. */
const EXCLUDED_FETCHER_KEY_PREFIXES = [
  "inline-edit-",
  "toggle-star-",
  "delete-preset-",
  "audit-asset-note-",
  "quick-image-upload-",
  "mark-update-read-",
  "scan-history-",
] as const;

/**
 * Whether a fetcher is kept off the progress bar.
 *
 * @param key - The fetcher's key
 * @returns True when the fetcher's UI gives its own feedback
 */
export function isFetcherExcludedFromProgress(key: string): boolean {
  return (
    excludeFetchers.includes(key) ||
    EXCLUDED_FETCHER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/** Starts and completes the global progress bar. */
export function useNprogress() {
  const transition = useNavigation();

  const fetchers = useFetchers();

  const filteredFetchers = fetchers.filter(
    (fetcher) => !isFetcherExcludedFromProgress(fetcher.key)
  );

  const state = useMemo<"idle" | "loading">(
    function getGlobalState() {
      const states = [
        transition.state,
        ...filteredFetchers.map((fetcher) => fetcher.state),
      ];
      if (states.every((state) => state === "idle")) return "idle";
      return "loading";
    },
    [transition.state, filteredFetchers]
  );

  useEffect(() => {
    // waiting for the loaders of the next location so we start it
    if (state === "loading") NProgress.start();
    // when the state is idle then we can to complete the progress bar
    if (state === "idle") NProgress.done();
  }, [state]);
}
