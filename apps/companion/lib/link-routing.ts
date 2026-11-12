/**
 * Who opens an incoming link: expo-router (through the `app/+native-intent.ts`
 * rewrite) or the JS deep-link hook (`useDeepLinkHandler` in
 * `lib/deep-links.ts`). Exactly one of them acts on each link, or the link
 * either opens nothing or opens twice.
 *
 * The rule: every link that names a screen of this app (the claimed resource
 * paths, on `https://` and on `shelf://`) is opened by the hook, through
 * `openLinkedRoute`, which roots the target tab at its list first. The router
 * opens such a link without that root, so the detail screen would have no
 * back button and the tab's list would be unreachable. The router therefore
 * opens none of them: at launch it starts on the start screen, and while the
 * app runs it ignores the link. Links that name no screen of this app (the
 * sign-in callback, anything outside the allowlist) stay with the router.
 *
 * Pure (no React Native imports) so it runs under Node's test runner.
 *
 * @see ./deep-links.ts
 * @see ../app/+native-intent.ts
 * @see ./navigation.ts `openLinkedRoute`
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

/** What `redirectSystemPath` in `app/+native-intent.ts` receives. */
export type SystemPathInput = {
  /** The raw URL the OS delivered (scheme, host, path and query). */
  path: string;
  /** True for the URL that launched the app (cold start). */
  initial: boolean;
};

/**
 * Whether the router must leave this link alone: it is on the claimed-path
 * allowlist. The hook then opens the screen it names (`linkAction`), or
 * nothing when it names none (an empty path, a refused id).
 *
 * @param url - the raw URL the OS delivered
 * @returns true when the link is the hook's, false when it is the router's
 */
function isKeptFromRouter(url: string): boolean {
  return nativeRouteForLink(url) !== url;
}

/**
 * What the router opens for a URL the OS delivered. This is the whole body of
 * `redirectSystemPath`.
 *
 * - A link on the allowlist: the start screen at launch, so the app boots
 *   normally while the hook opens the link on top of it, and nothing while the
 *   app runs (expo-router ignores a `null` path).
 * - Any other URL: unchanged, for the router to match.
 *
 * @param input - the URL and whether it launched the app
 * @returns the path the router opens, or null for none
 */
export function systemPathFor({
  path,
  initial,
}: SystemPathInput): string | null {
  if (!isKeptFromRouter(path)) return path;
  return initial ? "/" : null;
}

/**
 * What the deep-link hook does with a link, warm or cold, on every platform:
 *
 * - `route`: open `route` with `openLinkedRoute` (anchored in its tab). The
 *   route comes from `nativeRouteForLink`, the same mapping `systemPathFor`
 *   reads, so every link the router leaves alone that names a screen (a
 *   detail, a list, the scanner, the new-asset form) opens here, with nested
 *   kit ids and the query (`/assets/new?qrId=...`) kept, for `https://` and
 *   `shelf://` alike.
 * - `qr`: resolve the QR code through the API, then open what it names.
 * - `none`: the link names nothing the app opens.
 */
export type LinkAction =
  | { kind: "route"; route: string }
  | { kind: "qr" }
  | { kind: "none" };

/**
 * Decides what the deep-link hook does with a link. The hook only carries out
 * the result, so every link rule lives here, covered by `link-routing.test.ts`.
 *
 * @param url - the raw URL the OS delivered
 * @param linkType - the link kind `parseDeepLink` read from the URL
 * @returns the action the hook takes
 */
export function linkAction(url: string, linkType: LinkKind): LinkAction {
  if (linkType === "qr") return { kind: "qr" };
  const route = nativeRouteForLink(url);
  if (route === "/" || route === url) return { kind: "none" };
  return { kind: "route", route };
}
