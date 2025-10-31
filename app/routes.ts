import {
  defineRoutes,
  routeManifestToRouteConfig,
  type RouteConfig,
} from "@remix-run/dev/dist/config/routes";
import { flatRoutes } from "remix-flat-routes";

// Generate a route config that mirrors the flat-routes convention so Remix can
// lazily discover route metadata when the v3 lazy route discovery flag is
// enabled. This keeps the manifest consistent with the routes option used in
// vite.config.ts and prepares the app for the React Router v7 upgrade.
const manifest = flatRoutes("routes", defineRoutes, {
  ignoredRouteFiles: ["**/.*", "**/*.test.server.ts"],
});

export default routeManifestToRouteConfig(manifest) satisfies RouteConfig;
