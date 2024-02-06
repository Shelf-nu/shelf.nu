const { flatRoutes } = require("remix-flat-routes");
/**
 * @type {import('@remix-run/dev').AppConfig}
 */

module.exports = {
  ignoredRouteFiles: ["**/.*"],
  serverModuleFormat: "cjs",
  server: "./server/index.ts",
  serverBuildPath: "./build/index.js",
  serverPlatform: "node",
  serverDependenciesToBundle: [
    "maplibre-gl",
    /swiper/,
    /^@remix-pwa*/,
    /remix-utils/,
    /^remix-hono*/,
  ],
  watchPaths: ["./server/**/*.ts"],
  dev: {
    command: "node build/index.js",
    // 👇 For https dev server
    // tlsCert: "./server/dev/cert.pem",
    // tlsKey: "./server/dev/key.pem",
  },
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
};
