import { useMemo } from "react";
import type { Path, UIMatch } from "@remix-run/react";
import {
  parsePath,
  resolvePath,
  useLocation,
  useMatches,
  useResolvedPath,
} from "@remix-run/react";

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
  const matches = useMatches();
  let routePathnamesJson = JSON.stringify(getResolveToMatches(matches));

  const resolvedPaths = useMemo(
    () =>
      routes.map((route) =>
        resolveTo(route, JSON.parse(routePathnamesJson), locationPathname)
      ),
    [locationPathname, routePathnamesJson, routes]
  );

  return resolvedPaths.some((path) =>
    isRouteActive({
      toPathname: path.pathname,
      locationPathname,
    })
  );
}

/*****************************/
/***** Utility Functions *****/
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

/**
 * This function is directly taken from github repo of react-router
 * https://github.com/remix-run/react-router/blob/main/packages/react-router/lib/router/utils.ts#L1226
 */
export function resolveTo(
  toArg: string,
  routePathnames: string[],
  locationPathname: string,
  isPathRelative = false
): Path {
  let to: Partial<Path>;
  to = parsePath(toArg);

  let isEmptyPath = toArg === "" || to.pathname === "";
  let toPathname = isEmptyPath ? "/" : to.pathname;

  let from: string;

  // Routing is relative to the current pathname if explicitly requested.
  //
  // If a pathname is explicitly provided in `to`, it should be relative to the
  // route context. This is explained in `Note on `<Link to>` values` in our
  // migration guide from v5 as a means of disambiguation between `to` values
  // that begin with `/` and those that do not. However, this is problematic for
  // `to` values that do not provide a pathname. `to` can simply be a search or
  // hash string, in which case we should assume that the navigation is relative
  // to the current location's pathname and *not* the route pathname.
  if (toPathname == null) {
    from = locationPathname;
  } else {
    let routePathnameIndex = routePathnames.length - 1;

    // With relative="route" (the default), each leading .. segment means
    // "go up one route" instead of "go up one URL segment".  This is a key
    // difference from how <a href> works and a major reason we call this a
    // "to" value instead of a "href".
    if (!isPathRelative && toPathname.startsWith("..")) {
      let toSegments = toPathname.split("/");

      while (toSegments[0] === "..") {
        toSegments.shift();
        routePathnameIndex -= 1;
      }

      to.pathname = toSegments.join("/");
    }

    from = routePathnameIndex >= 0 ? routePathnames[routePathnameIndex] : "/";
  }

  let path = resolvePath(to, from);

  // Ensure the pathname has a trailing slash if the original "to" had one
  let hasExplicitTrailingSlash =
    toPathname && toPathname !== "/" && toPathname.endsWith("/");
  // Or if this was a link to the current path which has a trailing slash
  let hasCurrentTrailingSlash =
    (isEmptyPath || toPathname === ".") && locationPathname.endsWith("/");
  if (
    !path.pathname.endsWith("/") &&
    (hasExplicitTrailingSlash || hasCurrentTrailingSlash)
  ) {
    path.pathname += "/";
  }

  return path;
}

// Return the array of pathnames for the current route matches - used to
// generate the routePathnames input for resolveTo()
export function getResolveToMatches(matches: UIMatch[]) {
  let pathMatches = getPathContributingMatches(matches);

  // Use the full pathname for the leaf match so we include splat values for "." links
  // https://github.com/remix-run/react-router/issues/11052#issuecomment-1836589329
  // This mirrors the behaviour behind Remix's `v3_relativeSplatPath` flag so
  // downstream helpers continue to resolve nested splat routes correctly while
  // we prepare for React Router v7.
  return pathMatches.map((match: any, idx: number) =>
    idx === pathMatches.length - 1 ? match?.pathname : match?.pathnameBase
  );
}

export function getPathContributingMatches(matches: any) {
  return matches.filter(
    (match: any, index: number) =>
      index === 0 || (match?.route?.path && match?.route?.path?.length > 0)
  );
}
