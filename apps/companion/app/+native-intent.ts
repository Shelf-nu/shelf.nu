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
 * Which paths count is decided by `matchResourcePath` (`lib/resource-path.ts`),
 * the allowlist push taps match against too; this file maps each matched
 * resource to its native route.
 *
 * @see {@link file://./../lib/deep-links.ts}
 * @see {@link file://./../lib/resource-path.ts} the shared path allowlist
 */
import { matchResourcePath, splitLinkUrl } from "../lib/resource-path";

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
    const { segments, query } = splitLinkUrl(path);
    if (segments.length === 0) return "/";

    // Re-attach the original query so param-consuming routes keep working
    // (e.g. /assets/new?qrId=... reads qrId via useLocalSearchParams to link
    // the scanned QR to the created asset). Extra params on routes that
    // ignore them are harmless.
    const withQuery = (route: string) => (query ? `${route}?${query}` : route);

    const match = matchResourcePath(segments);
    // Not a claimed prefix (dev-client URLs, custom-scheme extras): leave the
    // URL unchanged so existing behavior is preserved. `app/+not-found.tsx`
    // catches anything the router still can't match.
    if (!match) return path;
    const { resource, id } = match;

    switch (resource) {
      case "assets":
        // Any deeper web path (/assets/:id/overview, /assets/:id/activity...)
        // maps to the native asset detail, which is what the tapper wants.
        // This also covers /assets/new (id = "new" opens the create screen).
        return withQuery(id ? `/assets/${id}` : "/assets");
      case "kits":
        // The kit detail lives inside the assets stack.
        return withQuery(id ? `/assets/kits/${id}` : "/assets");
      case "bookings":
        return withQuery(id ? `/bookings/${id}` : "/bookings");
      case "audits":
        return withQuery(id ? `/audits/${id}` : "/audits");
      case "qr":
        // Needs an async API resolve (asset vs kit vs other-org) that a path
        // rewrite cannot express. Land on the start screen; useDeepLinkHandler
        // reads the original URL via Linking and navigates once resolved.
        return "/";
      case "scanner":
        return "/scanner";
    }
  } catch {
    // Never let a parse error strand the user — fall back to the start screen.
    return "/";
  }
}
