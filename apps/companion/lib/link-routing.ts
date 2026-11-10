/**
 * Who opens an incoming link: expo-router (through the `app/+native-intent.ts`
 * rewrite) or the JS deep-link hook (`useDeepLinkHandler` in
 * `lib/deep-links.ts`). Exactly one of them must act on each link, or the
 * link either opens nothing or opens twice.
 *
 * Pure (no React Native imports) so it runs under Node's test runner.
 *
 * @see ./deep-links.ts
 * @see ../app/+native-intent.ts
 */
import { nativeRouteForLink } from "./resource-path";

/** What the hook needs to know about a link to decide who opens it. */
export type LinkRoutingInput = {
  /** The raw URL the OS delivered. */
  url: string;
  /** The link kind parsed from the URL (`"qr"`, `"asset"`, ...). */
  linkType: string;
  /** True for the URL that launched the app (cold start). */
  initial: boolean;
  /** `Platform.OS` of the running app. */
  platform: string;
};

/**
 * Whether expo-router opens this link on its own, so the JS deep-link hook
 * must leave it alone.
 *
 * - Custom-scheme links (`shelf://...`) are always opened by the hook.
 * - `/qr/:id` is always opened by the hook: it needs an API call to know
 *   whether the code belongs to an asset or a kit.
 * - Any other HTTPS link that arrives while the app is running is opened by
 *   the router on both platforms.
 * - The HTTPS link that launches the app is opened by the router on Android
 *   only. On iOS, under the scene life cycle, the router does not open the
 *   launch URL, so the hook opens it there.
 *
 * @param input - the link and the context it arrived in
 * @returns true when the hook must not navigate for this link
 */
export function isOpenedByRouter({
  url,
  linkType,
  initial,
  platform,
}: LinkRoutingInput): boolean {
  if (!/^https?:/i.test(url)) return false;
  if (linkType === "qr") return false;
  if (initial && platform === "ios") return false;
  return true;
}

/**
 * The in-app route for an HTTPS link the hook opens itself (the iOS launch
 * link), taken from the same `nativeRouteForLink` mapping the router uses, so
 * it keeps what the link carries: nested kit ids (`/assets/kits/:id`) and the
 * query (`/assets/new?qrId=...`).
 *
 * @param url - the raw URL the OS delivered
 * @param linkType - the link kind parsed from the URL
 * @returns the route to open, or null when the hook must not open a route for
 *   this link: not HTTPS, a `/qr/:id` link (resolved through the API instead),
 *   the start screen, or a path outside the allowlist
 */
export function webLaunchRoute(url: string, linkType: string): string | null {
  if (!/^https?:/i.test(url) || linkType === "qr") return null;
  const route = nativeRouteForLink(url);
  if (route === "/" || route === url) return null;
  return route;
}
