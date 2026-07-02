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
 * @see {@link file://./../lib/deep-links.ts}
 */

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
 * Extracts the resource path segments from a raw incoming URL.
 *
 * Handles all three shapes the router hands us:
 * - `https://app.shelf.nu/assets/:id/overview` → host dropped → ["assets", ":id", "overview"]
 * - `shelf://assets/:id` → custom scheme: the first component IS the resource → ["assets", ":id"]
 * - `/assets/:id` (already a path) → ["assets", ":id"]
 *
 * @param url - the raw URL or path delivered by the OS
 * @returns the path segments, without scheme/host/query/hash
 */
function extractSegments(url: string): string[] {
  let rest = url;

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (schemeMatch) {
    rest = url.slice(schemeMatch[0].length);
    // For http(s) the first component is the domain — drop it. For custom
    // schemes (shelf://assets/:id) the first component is the resource
    // itself (expo-linking puts it in `hostname`) — keep it.
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      rest = rest.slice(rest.indexOf("/") + 1);
      // Domain-only URL (no path): nothing left to match.
      if (rest === url.slice(schemeMatch[0].length)) rest = "";
    }
  }

  // Strip query/hash; internal routes take no query params.
  const [pathname = ""] = rest.split(/[?#]/);
  return pathname.split("/").filter(Boolean);
}

/**
 * Rewrites OS-delivered link URLs to navigable in-app routes.
 *
 * @param args - the incoming URL and whether it launched the app
 * @returns the in-app path the router should resolve instead, or the
 *          original string unchanged when the URL isn't a claimed pattern
 */
export function redirectSystemPath({ path }: RedirectSystemPathArgs): string {
  try {
    const segments = extractSegments(path);
    if (segments.length === 0) return "/";

    const [resource, id] = segments;

    switch (resource) {
      case "assets":
        // Custom-scheme kit links can arrive as assets/kits/:id (the kit
        // detail lives inside the assets stack).
        if (id === "kits") {
          return segments[2] ? `/assets/kits/${segments[2]}` : "/assets";
        }
        // Any deeper web path (/assets/:id/overview, /assets/:id/activity…)
        // maps to the native asset detail — that is what the tapper wants.
        return id ? `/assets/${id}` : "/assets";
      case "kits":
        return id ? `/assets/kits/${id}` : "/assets";
      case "bookings":
        return id ? `/bookings/${id}` : "/bookings";
      case "audits":
        return id ? `/audits/${id}` : "/audits";
      case "qr":
        // Needs an async API resolve (asset vs kit vs other-org) that a path
        // rewrite cannot express. Land on the start screen; useDeepLinkHandler
        // reads the original URL via Linking and navigates once resolved.
        return "/";
      case "scanner":
      case "scan":
        return "/scanner";
      default:
        // Not a claimed prefix (dev-client URLs, custom-scheme extras): leave
        // the URL unchanged so existing behavior is preserved.
        // `app/+not-found.tsx` catches anything the router still can't match.
        return path;
    }
  } catch {
    // Never let a parse error strand the user — fall back to the start screen.
    return "/";
  }
}
