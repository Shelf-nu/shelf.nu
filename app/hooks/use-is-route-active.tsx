import type { Path } from "@remix-run/react";
import { useLocation, useResolvedPath } from "@remix-run/react";

/**
 * This function returns the active state of a route.
 * It works similar to {@link NavLink} from react-router
 */
export function useIsRouteActive(to: string) {
  const path = useResolvedPath(to);
  const toPathname = path.pathname;

  const locationPathname = useLocation().pathname;

  return isRouteActive({ toPathname, locationPathname });
}

export function useIsAnyRouteActive(routes: string[]) {
  const locationPathname = useLocation().pathname;

  const resolvedPaths: Path[] = [];

  routes.forEach((route) => {
    // Hooks like useResolvedPath must be called within a React component or hook.
    // To comply with React's rules of hooks, we define a temporary component
    // (ResolvedPathComponent) to call useResolvedPath for each route, ensuring it
    // is invoked in a valid React context.
    const ResolvedPathComponent = () => {
      const resolvedPath = useResolvedPath(route);
      resolvedPaths.push(resolvedPath);
    };

    ResolvedPathComponent();
  });

  return resolvedPaths.some((path) =>
    isRouteActive({
      toPathname: path.pathname,
      locationPathname,
    })
  );
}

/*****************************/
/***** Utility Fucntion  *****/
/*****************************/

function isRouteActive({
  toPathname,
  locationPathname,
}: {
  toPathname: string;
  locationPathname: string;
}) {
  // If the `to` has a trailing slash, look at that exact spot.  Otherwise,
  // we're looking for a slash _after_ what's in `to`.  For example:
  //
  // <NavLink to="/users"> and <NavLink to="/users/">
  // both want to look for a / at index 6 to match URL `/users/matt`
  const endSlashPosition =
    toPathname !== "/" && toPathname.endsWith("/")
      ? toPathname.length - 1
      : toPathname.length;

  const isActive =
    locationPathname === toPathname ||
    (locationPathname.startsWith(toPathname) &&
      locationPathname.charAt(endSlashPosition) === "/");

  return isActive;
}
