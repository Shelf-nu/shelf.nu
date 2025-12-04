import { useMemo, useEffect } from "react";
import NProgress from "nprogress";
import { useNavigation, useFetchers } from "react-router";

export function useNprogress() {
  const transition = useNavigation();

  const fetchers = useFetchers();

  /** Fetchers we dont want to trigger a loading bar */
  const excludeFetchers = [
    "asset-index-settings-show-image",
    "asset-index-settings-freeze-column",
    "updates-change",
    "add-note",
  ];
 // Filter out fetchers that have a key from the excludeFetchers array
 const filteredFetchers = fetchers.filter(
   (fetcher) =>
     !excludeFetchers.includes(fetcher.key) &&
      !fetcher.key.startsWith("toggle-star-") &&
      !fetcher.key.startsWith("delete-preset-")
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
