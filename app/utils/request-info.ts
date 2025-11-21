import { useRouteLoaderData } from "react-router";
import type { loader } from "~/root";

/**
 * @returns the request info from the root loader
 */
export function useRequestInfo() {
  const data = useRouteLoaderData("root") as Awaited<ReturnType<typeof loader>>;
  return data.requestInfo;
}
