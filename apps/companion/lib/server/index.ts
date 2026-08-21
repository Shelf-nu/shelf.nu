/**
 * Public surface of the multi-server module.
 *
 * Screens and providers should import from here. Low-level modules on the hot
 * path (`lib/api/client.ts`, `lib/api/cache.ts`, `lib/sentry.ts`) import
 * `./active-server` directly instead — going through this barrel would pull
 * `./discovery` into their dependency graph for no benefit.
 *
 * @see ./contract.ts
 * @see ./active-server.ts
 * @see ./discovery.ts
 */
export * from "./contract";
// `CLOUD_SERVER` and `setActiveServer` are deliberately NOT re-exported: only
// ./discovery.ts drives a switch, and it imports ./active-server directly.
// Exposing them here would invite a screen to switch servers without going
// through discovery, skipping the config validation that makes it safe.
export {
  getActiveServer,
  getServerVersion,
  hydrateActiveServer,
  subscribeToServerChange,
} from "./active-server";
export { resolveServerForEmail, type DiscoveryOutcome } from "./discovery";
