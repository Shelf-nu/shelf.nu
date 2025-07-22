import { useSearchParams } from "./search-params";
import { useIsUserAssetsPage } from "./use-is-user-assets-page";
import { useViewportHeight } from "./use-viewport-height";

/**
 * Hook to determine if the current view is the availability view.
 * @returns `true` if the current view is the availability view, `false` otherwise.
 */
export function useIsAvailabilityView() {
  const isUserPage = useIsUserAssetsPage();
  const { isMd } = useViewportHeight();
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "table";
  const isAvailabilityView = view === "availability";

  const shouldShowAvailabilityView = !isUserPage && isMd;

  return { isAvailabilityView, shouldShowAvailabilityView };
}
