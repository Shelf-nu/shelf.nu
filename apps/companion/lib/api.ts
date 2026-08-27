/**
 * Public surface of the API layer.
 *
 * Screens import from `@/lib/api` and never from `./api/*` directly, so the
 * client's internals stay free to move. The base URL is not a constant: the app
 * can be connected to Shelf Cloud or to a customer's own instance, so callers
 * read `getApiBaseUrl()` at request time and must never capture it.
 *
 * @see {@link file://./api/client.ts} the fetch wrapper, retries and auth
 */
export { api, onAuthError, invalidateResponseCache } from "./api/index";
export * from "./api/types";
export { getApiBaseUrl } from "./api/client";
