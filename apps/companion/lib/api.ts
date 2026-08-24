/**
 * Public surface of the API layer.
 *
 * Screens import from `@/lib/api` and never from `./api/*` directly, so the
 * client's internals stay free to move. `API_BASE_URL` is resolved once at
 * module load from `EXPO_PUBLIC_API_URL`, falling back to the production host
 * outside `__DEV__`.
 *
 * @see {@link file://./api/client.ts} the fetch wrapper, retries and auth
 */
export { api, onAuthError, invalidateResponseCache } from "./api/index";
export * from "./api/types";
export { API_BASE_URL } from "./api/client";
