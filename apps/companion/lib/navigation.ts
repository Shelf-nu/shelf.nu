import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";

/**
 * Tab index routes. Pushing one of these roots that tab's stack at its list
 * screen, so a subsequent push of a nested route has a back target.
 */
export type TabRoot =
  | "/(tabs)/assets"
  | "/(tabs)/bookings"
  | "/(tabs)/audits"
  | "/(tabs)/scanner"
  | "/(tabs)/home"
  | "/(tabs)/settings";

/**
 * Navigate into a tab's nested route from anywhere — another tab, a deep
 * link, or a cold start — WITHOUT stranding the user.
 *
 * expo-router does not auto-root the target tab at its index, so a bare
 * `router.push("/(tabs)/assets/<id>")` from another surface pushes the
 * detail screen onto the target tab's stack with no list beneath it. The
 * native back button / `router.back()` then has nothing to pop and the
 * user is trapped (and it is reproducible from a deep link → App Store
 * Guideline 2.1 rejection).
 *
 * This roots the tab at its list first, then pushes the nested route, so
 * "back" returns to the list as the user expects — mirroring the working
 * same-stack list→detail navigation.
 *
 * Every cross-surface navigation into a tab's nested route MUST go through
 * this helper. Do not call `router.push("/(tabs)/<tab>/<id>")` directly
 * from outside that tab's own stack.
 *
 * @param tabRoot - the target tab's index route
 * @param nestedHref - optional nested route to push on top (e.g. a detail)
 * @returns void — performs navigation as a synchronous side-effect
 * @throws Propagates any navigation error thrown by expo-router's `router`
 */
export function pushIntoTab(tabRoot: TabRoot, nestedHref?: Href) {
  // `withAnchor` tells expo-router to include the target stack's anchor
  // screen (its `unstable_settings.initialRouteName`, set to "index" in
  // each tab's _layout) beneath the navigated route, so the list sits
  // under the detail and "back" works — even when the tab was never
  // mounted (e.g. the app launched straight onto the Scanner tab). This
  // is the documented in-app mechanism; a bare push or a push("/tab")
  // then push(detail) does NOT anchor the list and strands the user.
  router.navigate(nestedHref ?? tabRoot, { withAnchor: true });
}

/**
 * Open a `shelf.nu` web URL in an in-app browser (Custom Tab on Android,
 * SFSafariViewController on iOS).
 *
 * Use this — NOT `Linking.openURL` — for any `https://app.shelf.nu/...` link
 * whose path the app claims as a Universal Link / App Link (`/qr`, `/assets`,
 * `/bookings`, `/audits`). On Android, `Linking.openURL` of a *verified*
 * app-link is re-intercepted by the system and re-launches this app — so a
 * deep link that fails to resolve in-app and falls back to its own web URL
 * would loop straight back into the failing handler. An in-app browser renders
 * the page directly without re-triggering link interception, making web
 * fallbacks loop-safe on both platforms.
 *
 * @param url - the absolute https URL to open
 * @returns the `WebBrowser.openBrowserAsync` promise (resolves when dismissed)
 */
export function openShelfWebUrl(url: string) {
  return WebBrowser.openBrowserAsync(url);
}
