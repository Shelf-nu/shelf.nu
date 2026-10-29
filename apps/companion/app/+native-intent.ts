/**
 * expo-router native intent hook.
 *
 * `redirectSystemPath` runs for every URL the OS delivers to the app
 * (Universal Links / App Links and custom-scheme links), BEFORE the router
 * resolves a route — on cold start (`initial: true`) and on warm `url`
 * events (`initial: false`). Returning a different string rewrites what the
 * router navigates to.
 *
 * IMPORTANT (verified against expo-router 6.0.23 source,
 * `build/getLinkingConfig.js` + `build/link/linking.js`): in a bare app the
 * `path` argument is the RAW FULL URL (`https://app.shelf.nu/assets/:id/overview`,
 * `shelf://assets/:id`), not a path — so this function normalises scheme and
 * host before matching.
 *
 * Why this exists: the OS delivers every nested path under a claimed prefix
 * (e.g. `/assets/:id/overview` — the canonical web asset URL), but the native
 * app only has routes for the resource details. Without a rewrite the router
 * lands on an unmatched route at cold start and the user is stuck behind the
 * splash screen with no navigation running (the 1.1.0 build-25 hang). Mapping
 * every claimed prefix to a real native screen here makes cold-start links
 * deterministic and removes any timing race with the JS deep-link listener.
 *
 * Kept in sync with the claimed-path allowlist — see
 * `.claude/rules/companion-deep-link-allowlist.md`, the iOS AASA route and
 * `android.intentFilters` in app.json. `/qr/:id` is the one claimed path that
 * cannot be rewritten synchronously (needs an API resolve to know whether it
 * is an asset or a kit) — it lands on the start screen and
 * `useDeepLinkHandler` (lib/deep-links.ts) finishes the job from the original
 * URL.
 *
 * Which paths count, and the native route each maps to, is decided by
 * `nativeRouteForLink` (`lib/resource-path.ts`), which matches through the
 * same allowlist push taps use.
 *
 * @see {@link file://./../lib/deep-links.ts}
 * @see {@link file://./../lib/resource-path.ts} the shared path allowlist
 */
import { nativeRouteForLink } from "../lib/resource-path";

type RedirectSystemPathArgs = {
  /**
   * The URL that opened the app. On native this is the raw full URL
   * (scheme + host + path + query), despite the parameter name.
   */
  path: string;
  /** True when the URL is the app's launch (cold start) URL. */
  initial: boolean;
};

/**
 * Rewrites OS-delivered link URLs to navigable in-app routes.
 *
 * @param args - the incoming URL and whether it launched the app
 * @returns the in-app path the router should resolve instead, or the
 *          original string unchanged when the URL isn't a claimed pattern
 */
export function redirectSystemPath({ path }: RedirectSystemPathArgs): string {
  try {
    return nativeRouteForLink(path);
  } catch {
    // Never let a parse error strand the user: fall back to the start screen.
    return "/";
  }
}
