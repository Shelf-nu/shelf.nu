import type { UIMatch } from "@remix-run/react";
import { useMatches } from "@remix-run/react";

/**
 * @description This hook checks if the current page is a user page.
 */
export function useIsUserAssetsPage(): boolean {
  const matches = useMatches() as UIMatch<any, any>[];
  const currentRoute = matches[matches.length - 1];

  // Check if route exists, has a handle with a name property
  const routeName = currentRoute?.handle?.name;

  // Check if the name is included in our user page routes
  const isUserPage =
    typeof routeName === "string" &&
    ["$userId.assets", "me.assets"].includes(routeName);

  return isUserPage;
}
