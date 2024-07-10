import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the user data from within the _layout route
 */
export function useUserData() {
  let user = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")?.user;
  return user;
}
