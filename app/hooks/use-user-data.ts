import type { User } from "@prisma/client";

import { useMatchesData } from "./use-matches-data";

/**
 * This base hook is used to access the user data from within the _layout route
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useUserData(): User | undefined {
  let user = useMatchesData<{ user: User }>("routes/_layout+/_layout")?.user;
  return user;
}
