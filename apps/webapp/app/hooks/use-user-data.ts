import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the user data from within the _layout route
 */
export function useUserData() {
  const user = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.user;
  return user;
}
