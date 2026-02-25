import { useMemo } from "react";
import { useLocation, useMatches } from "react-router";

/**
 * This base hook is used to access data related to the current route
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useCurrentRouteData<HeaderData>() {
  const location = useLocation();
  const matchingRoutes = useMatches();
  const route = useMemo(
    () => matchingRoutes.find((route) => route.pathname === location.pathname),
    [matchingRoutes, location]
  );
  return route?.data || (undefined as HeaderData);
}
