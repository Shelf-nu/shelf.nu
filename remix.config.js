import { flatRoutes } from "remix-flat-routes";
/**
 * @type {import('@remix-run/dev').AppConfig}
 */

export const ignoredRouteFiles = ["**/.*"];
export async function routes(defineRoutes) {
  return flatRoutes("routes", defineRoutes);
}
export const future = {
  unstable_tailwind: true,
  v2_meta: true,
  v2_routeConvention: true,
};
