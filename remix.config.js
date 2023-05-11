const { flatRoutes } = require("remix-flat-routes");
/**
 * @type {import('@remix-run/dev').AppConfig}
 */

module.exports = {
  ignoredRouteFiles: ["**/.*"],
  serverDependenciesToBundle: ["react-leaflet", "@react-leaflet/core"],
  routes: async (defineRoutes) => {
    return flatRoutes("routes", defineRoutes);
  },
  future: {
    unstable_tailwind: true,
    v2_meta: true,
    v2_routeConvention: true,
  },
};
