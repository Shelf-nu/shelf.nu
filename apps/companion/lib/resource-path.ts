/**
 * The app's resource path allowlist: which web paths name something the app
 * can open natively.
 *
 * Two callers turn a path into a screen. `redirectSystemPath` in
 * `app/+native-intent.ts` rewrites every link the OS delivers (universal
 * links, App Links and `shelf://` links), and `resolvePushRoute` in
 * `lib/push/routing.ts` opens the screen a tapped push is about. Both match
 * through {@link matchResourcePath}, so a resource that gains a native screen
 * is added here once and reaches both.
 *
 * The first segment names the resource and the second its id. Any deeper web
 * path (`/assets/:id/overview`) still names that resource's detail, which is
 * what the tapper wants. The claimed-path allowlist outside the app (the iOS
 * association file and `android.intentFilters`) must stay in step with this
 * one; see `.claude/rules/companion-deep-link-allowlist.md`.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./resource-path.test.ts}
 * @see {@link file://../app/+native-intent.ts}
 * @see {@link file://./push/routing.ts}
 */

/** A resource the app has a native screen for. */
export type ResourceName =
  | "assets"
  | "kits"
  | "bookings"
  | "audits"
  | "scanner"
  | "qr";

/**
 * A matched resource path. `id` is the second segment (the third for
 * `/assets/kits/:id`), or null for the resource's list.
 */
export type ResourcePath = { resource: ResourceName; id: string | null };

/**
 * Splits a raw link into path segments and its query string.
 *
 * Handles the three shapes a link arrives in:
 * - `https://app.shelf.nu/assets/:id/overview`: the host is dropped
 * - `shelf://assets/:id`: a custom scheme's first part IS the resource, so it
 *   is kept
 * - `/assets/:id`: already a path
 *
 * The query is kept, because some routes read it (`/assets/new?qrId=...`
 * links a scanned code to the asset being created). The hash is dropped.
 *
 * @param url - The raw URL or path
 * @returns The path segments (no scheme, host, query or hash) and the query
 *   string without its `?`
 */
export function splitLinkUrl(url: string): {
  segments: string[];
  query: string;
} {
  let rest = url;

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (schemeMatch) {
    rest = url.slice(schemeMatch[0].length);
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "http" || scheme === "https") {
      const slash = rest.indexOf("/");
      // A domain-only URL has no path left to match.
      rest = slash === -1 ? "" : rest.slice(slash + 1);
    }
  }

  const hashless = rest.split("#")[0] ?? "";
  const queryStart = hashless.indexOf("?");
  const pathname = queryStart === -1 ? hashless : hashless.slice(0, queryStart);
  const query = queryStart === -1 ? "" : hashless.slice(queryStart + 1);

  return { segments: pathname.split("/").filter(Boolean), query };
}

/**
 * Matches path segments against the allowlist.
 *
 * - `assets/:id` and deeper name an asset (`assets/new` included: a link can
 *   open the create screen)
 * - `kits/:id` and `assets/kits/:id` name a kit, which lives in the assets
 *   stack
 * - `bookings/:id` and `audits/:id` and deeper name a booking or an audit
 * - `qr/:id` names a scanned code, which only an API call can resolve
 * - `scanner` and `scan` name the scanner
 * - a resource without an id names its list
 *
 * @param segments - Path segments, as {@link splitLinkUrl} returns them
 * @returns The resource and id, or null when the path is not on the allowlist
 */
export function matchResourcePath(
  segments: readonly string[]
): ResourcePath | null {
  const [resource, id = null, nestedId = null] = segments;

  switch (resource) {
    case "assets":
      if (id === "kits") return { resource: "kits", id: nestedId };
      return { resource: "assets", id };
    case "kits":
    case "bookings":
    case "audits":
    case "qr":
      return { resource, id };
    case "scanner":
    case "scan":
      return { resource: "scanner", id: null };
    default:
      return null;
  }
}

/**
 * The in-app route for a link the OS delivered, as `redirectSystemPath` in
 * `app/+native-intent.ts` returns it.
 *
 * Every matched resource maps to a real native screen, so a cold start never
 * lands on an unmatched route. The query is re-attached, because some routes
 * read it (`/assets/new?qrId=...`); routes that ignore it are unaffected.
 *
 * - `assets/:id` and deeper open the asset (`assets/new` the create screen)
 * - `kits/:id` and `assets/kits/:id` open the kit, `kits` the kits list
 * - `bookings` and `audits` open the detail or the list
 * - `qr/:id` lands on the start screen: only an API call can tell an asset
 *   from a kit, and `useDeepLinkHandler` (`lib/deep-links.ts`) finishes the
 *   job from the original URL
 * - `scanner` and `scan` open the scanner
 *
 * @param url - The raw URL the OS delivered (scheme, host, path and query)
 * @returns The in-app route, `/` for an empty path, or `url` unchanged when it
 *   is not on the allowlist (dev-client URLs, custom-scheme extras), which
 *   `app/+not-found.tsx` catches if the router cannot match it either
 */
export function nativeRouteForLink(url: string): string {
  const { segments, query } = splitLinkUrl(url);
  if (segments.length === 0) return "/";

  const match = matchResourcePath(segments);
  if (!match) return url;
  const { resource, id } = match;
  const withQuery = (route: string) => (query ? `${route}?${query}` : route);

  switch (resource) {
    case "assets":
      return withQuery(id ? `/assets/${id}` : "/assets");
    case "kits":
      return withQuery(id ? `/assets/kits/${id}` : "/assets/kits");
    case "bookings":
      return withQuery(id ? `/bookings/${id}` : "/bookings");
    case "audits":
      return withQuery(id ? `/audits/${id}` : "/audits");
    case "qr":
      return "/";
    case "scanner":
      return "/scanner";
  }
}
