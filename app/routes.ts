// import type { RouteConfig } from "@react-router/dev/routes";
// import { flatRoutes } from "@react-router/fs-routes";

// export default flatRoutes() satisfies RouteConfig;

import { remixRoutesOptionAdapter } from "@react-router/remix-routes-option-adapter";
import { flatRoutes } from "remix-flat-routes";

export default remixRoutesOptionAdapter((defineRoutes) =>
  flatRoutes("routes", defineRoutes, {
    ignoredRouteFiles: ["**/.*", "**/*.test.server.ts"], // Ignore dot files and test files
  })
);
