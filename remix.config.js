const { flatRoutes } = require("remix-flat-routes");
/**
 * @type {import('@remix-run/dev').AppConfig}
 */

module.exports = {
  ignoredRouteFiles: ["**/.*"],
  serverModuleFormat: "cjs",
  serverDependenciesToBundle: [
    "maplibre-gl",
    /swiper/,
    /^@remix-pwa*/,
    /remix-utils/,
    /^remix-hono*/,
  ],
  routes: async (defineRoutes) => {
    return flatRoutes("routes", defineRoutes);
  },
  tailwind: true,
  browserNodeBuiltinsPolyfill: {
    modules: {
      util: true,
      stream: true,
      fs: true,
      os: true,
      path: true,
      child_process: true,
      events: true,
      buffer: true,
      crypto: true,
    },
  },
  server: "./server/index.ts",
  serverBuildPath: "./build/index.js",
  serverPlatform: "node",
};
