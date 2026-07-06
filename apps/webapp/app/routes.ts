// import type { RouteConfig } from "@react-router/dev/routes";
// import { flatRoutes } from "@react-router/fs-routes";

// export default flatRoutes() satisfies RouteConfig;

import { remixRoutesOptionAdapter } from "@react-router/remix-routes-option-adapter";
import { flatRoutes } from "remix-flat-routes";

export default remixRoutesOptionAdapter((defineRoutes) =>
  flatRoutes("routes", defineRoutes, {
    // Ignore dot files and ALL test files. The glob must cover plain `*.test.ts`
    // / `*.test.tsx` (not just `*.test.server.ts`) — otherwise a co-located route
    // test like `audits.start.test.ts` is treated as a route module and bundled
    // into the SSR server build, which then throws "vitest is not defined" at
    // runtime (the test-only global doesn't exist outside the vitest env).
    ignoredRouteFiles: ["**/.*", "**/*.test.*"],
  })
);
