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

/** The link kinds `parseDeepLink` (`lib/deep-links.ts`) returns. */
export type LinkKind =
  | "asset"
  | "kit"
  | "booking"
  | "audit"
  | "qr"
  | "scanner"
  | "unknown";

/**
 * The values of React Native's `Platform.OS`, written out because this module
 * must not import React Native.
 */
export type AppPlatform = "ios" | "android" | "web" | "windows" | "macos";

/** What the hook needs to know about a link to decide who opens it. */
export type LinkRoutingInput = {
  /** The raw URL the OS delivered. */
  url: string;
  /** The link kind parsed from the URL. */
  linkType: LinkKind;
  /** True for the URL that launched the app (cold start). */
  initial: boolean;
  /** `Platform.OS` of the running app. */
  platform: AppPlatform;
};

/**
 * Whether a URL is a web link (http or https) rather than a custom-scheme
 * link such as `shelf://`.
 *
 * @param url - the raw URL the OS delivered
 * @returns true for an http(s) URL
 */
export function isWebUrl(url: string): boolean {
  return /^https?:/i.test(url);
}

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
  if (!isWebUrl(url)) return false;
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
export function webLaunchRoute(url: string, linkType: LinkKind): string | null {
  if (!isWebUrl(url) || linkType === "qr") return null;
  const route = nativeRouteForLink(url);
  if (route === "/" || route === url) return null;
  return route;
}

/**
 * What the deep-link hook does with the URL that launched the app:
 *
 * - `route`: open `route`, the in-app path the router's own mapping names (an
 *   HTTPS launch link on iOS).
 * - `link`: open the parsed link with `navigateToLink` (a custom-scheme link,
 *   or a `/qr/:id` link that needs an API resolve).
 * - `none`: do nothing, because the router opens it (an HTTPS launch link on
 *   Android) or it names nothing the app opens.
 */
export type LaunchAction =
  | { kind: "route"; route: string }
  | { kind: "link" }
  | { kind: "none" };

/**
 * Decides what the deep-link hook does with the URL that launched the app.
 * The hook only carries out the result, so every launch rule lives here,
 * covered by `link-routing.test.ts`.
 *
 * @param input - the launch URL, its parsed kind and the platform
 * @returns the action the hook takes
 */
export function launchAction({
  url,
  linkType,
  platform,
}: Omit<LinkRoutingInput, "initial">): LaunchAction {
  if (isOpenedByRouter({ url, linkType, initial: true, platform })) {
    return { kind: "none" };
  }
  const route = webLaunchRoute(url, linkType);
  if (route) return { kind: "route", route };
  if (linkType === "unknown") return { kind: "none" };
  if (linkType === "qr" || !isWebUrl(url)) return { kind: "link" };
  return { kind: "none" };
}
