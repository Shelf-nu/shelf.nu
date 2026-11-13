/**
 * New Version Hooks
 *
 * React bindings for the build version checker. `useNewVersion` reads what
 * the tab knows about the server's build; `useBuildVersionChecks` decides
 * when to ask. Neither ever reloads the page: reloading is always the user's
 * click on `ReloadAppButton`.
 *
 * @see {@link file://./../utils/build-version-checker.ts} - the store these read
 * @see {@link file://./../components/layout/new-version-prompt.tsx} - the only caller of `useBuildVersionChecks`
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigation } from "react-router";
import type { BuildVersionState } from "~/utils/build-version-checker";
import {
  CURRENT_STATE,
  getBuildVersionChecker,
} from "~/utils/build-version-checker";

/** Server snapshot: SSR never knows of a newer build. */
const getServerSnapshot = () => CURRENT_STATE;

/**
 * Reads whether the server runs a newer build than this tab.
 *
 * @returns The checker's state; always `current` during SSR
 */
export function useNewVersion(): BuildVersionState {
  const checker = getBuildVersionChecker();
  return useSyncExternalStore(
    checker.subscribe,
    checker.getSnapshot,
    getServerSnapshot
  );
}

/**
 * Asks the server for its build at the moments a tab is likely to have gone
 * stale: when the tab becomes visible again and after each completed
 * navigation (both throttled), and right away when Vite reports that a lazy
 * chunk failed to preload. Mount it once, in the new-version prompt.
 *
 * There is no check on mount: a tab that just loaded runs the current build.
 */
export function useBuildVersionChecks(): void {
  const navigationState = useNavigation().state;
  const previousNavigationStateRef = useRef(navigationState);

  useEffect(() => {
    const previous = previousNavigationStateRef.current;
    previousNavigationStateRef.current = navigationState;
    if (navigationState === "idle" && previous !== "idle") {
      void getBuildVersionChecker().checkThrottled();
    }
  }, [navigationState]);

  useEffect(() => {
    const checker = getBuildVersionChecker();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checker.checkThrottled();
      }
    };
    // why: no preventDefault, so Vite still throws the import error and the
    // nearest error boundary handles it as usual
    const onPreloadError = () => {
      void checker.check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, []);
}
