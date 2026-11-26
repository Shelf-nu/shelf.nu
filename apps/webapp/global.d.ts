// declare the modules with missing types declarations here

declare module "changedpi";

/**
 * Ordered id of the build this bundle came from: a build timestamp in
 * milliseconds as a digit string, or "dev" under the dev server. Injected by
 * `define` in `vite.config.ts` (and `vitest.config.ts` for tests). Read it
 * through `getOwnBuildId()` in `app/utils/build-version.ts`.
 */
declare const __SHELF_BUILD_ID__: string;
