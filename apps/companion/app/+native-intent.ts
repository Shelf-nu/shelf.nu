/**
 * expo-router native intent hook.
 *
 * `redirectSystemPath` runs for every URL the OS delivers to the app
 * (Universal Links / App Links and custom-scheme links), BEFORE the router
 * resolves a route, on cold start (`initial: true`) and on warm `url`
 * events (`initial: false`). The string it returns is what the router opens;
 * `null` opens nothing (expo-router 58 `build/link/linking.js` skips a falsy
 * path, and `build/getLinkingConfig.js` starts at the root for a null launch
 * URL).
 *
 * In a bare app the `path` argument is the RAW FULL URL
 * (`https://app.shelf.nu/assets/:id/overview`, `shelf://assets/:id`), not a
 * path.
 *
 * The router opens no link that names a screen of the app. Opened by the
 * router, a detail screen in a tab the user has not opened yet has nothing
 * under it: no back button, and the tab's list cannot be reached. The
 * deep-link hook (`useDeepLinkHandler`, lib/deep-links.ts) opens those links
 * instead, through `openLinkedRoute`, which roots the tab at its list. At
 * launch the router starts on the start screen, never on an unmatched route,
 * so a nested claimed path (`/assets/:id/overview`) can never leave the app
 * on the splash screen.
 *
 * Which links count, and the route each opens, is decided by
 * `nativeRouteForLink` (`lib/resource-path.ts`), through the claimed-path
 * allowlist (`.claude/rules/companion-deep-link-allowlist.md`).
 *
 * @see {@link file://./../lib/link-routing.ts} `systemPathFor`, the rule
 * @see {@link file://./../lib/deep-links.ts} the hook that opens the links
 */
import { systemPathFor } from "../lib/link-routing";

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
 * Decides what the router opens for an OS-delivered URL (`systemPathFor`).
 * A link that names a screen of the app is opened by the deep-link hook,
 * anchored in its tab, so the router starts on the start screen for it at
 * launch and ignores it while the app runs.
 *
 * @param args - the incoming URL and whether it launched the app
 * @returns the path the router opens, the original string when the URL names
 *          no screen of the app, or null to open nothing
 */
export function redirectSystemPath({
  path,
  initial,
}: RedirectSystemPathArgs): string | null {
  try {
    return systemPathFor({ path, initial });
  } catch {
    // Never let a parse error strand the user: the start screen at launch,
    // and no change while the app runs.
    return initial ? "/" : null;
  }
}
