const { flatRoutes } = require("remix-flat-routes");
/**
 * @type {import('@remix-run/dev').AppConfig}
 */

module.exports = {
  ignoredRouteFiles: ["**/.*"],
  serverModuleFormat: "cjs",
  serverDependenciesToBundle: ["maplibre-gl"],
  routes: async (defineRoutes) => {
    return flatRoutes("routes", defineRoutes);
  },
  tailwind: true,
  future: {
    v2_dev: true,
    v2_meta: true,
    v2_headers: true,
    v2_routeConvention: true,
    v2_errorBoundary: true,
    v2_normalizeFormMethod: true,
  },
};
