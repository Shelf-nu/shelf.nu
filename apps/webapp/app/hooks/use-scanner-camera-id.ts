import { useRouteLoaderData } from "react-router";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";

/**
 * Hook to access the saved scanner camera ID from the user preferences cookie.
 * This allows persisting the user's camera selection across sessions.
 */
export function useScannerCameraId() {
  const layoutData = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  );

  return layoutData?.scannerCameraId;
}
