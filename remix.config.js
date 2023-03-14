/**
 * @type {import('@remix-run/dev').AppConfig}
 */
module.exports = {
  ignoredRouteFiles: ["**/.*"],
  future: {
    unstable_tailwind: true,
    unstable_cssModules: true,
    v2_meta: true,
    v2_routeConvention: true,
  },
};
