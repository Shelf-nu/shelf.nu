import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { joinOpensInFlight, openPastStaleLock } from "./browser-lock";
import { lightColors } from "./theme-colors";

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
 * this helper, or through `openLinkedRoute` for a route a claimed web link
 * maps to. Do not call `router.push("/(tabs)/<tab>/<id>")` directly
 * from outside that tab's own stack.
 *
 * @param tabRoot - the target tab's index route
 * @param nestedHref - optional nested route to push on top (e.g. a detail)
 * @returns void — performs navigation as a synchronous side-effect
 * @throws Propagates any navigation error thrown by expo-router's `router`
 */
export function pushIntoTab(tabRoot: TabRoot, nestedHref?: Href) {
  navigateAnchored(nestedHref ?? tabRoot);
}

/**
 * Open the in-app route a claimed web link maps to (`nativeRouteForLink`),
 * anchored the same way as `pushIntoTab` so "back" returns to that tab's list.
 *
 * @param route - an in-app path such as `/assets/as_1` or `/assets/new?qrId=q`
 */
export function openLinkedRoute(route: string) {
  // why: routes from nativeRouteForLink are runtime strings that the
  // typed-routes `Href` union cannot describe statically.
  navigateAnchored(route as Href);
}

/**
 * The one anchored navigation call behind `pushIntoTab` and
 * `openLinkedRoute`, so a change to how tabs are anchored reaches both.
 *
 * @param href - the route to open
 */
function navigateAnchored(href: Href) {
  // `withAnchor` tells expo-router to include the target stack's anchor
  // screen (its `unstable_settings.initialRouteName`, set to "index" in
  // each tab's _layout) beneath the navigated route, so the list sits
  // under the detail and "back" works, even when the tab was never
  // mounted (e.g. the app launched straight onto the Scanner tab). This
  // is the documented in-app mechanism; a bare push or a push("/tab")
  // then push(detail) does NOT anchor the list and strands the user.
  router.navigate(href, { withAnchor: true });
}

/**
 * Leave the booking scanner for the booking it serves.
 *
 * The booking scanner (`app/(tabs)/bookings/scan.tsx`) only runs directly on
 * top of its own booking in the Bookings stack (`sitsOnItsBooking`), so going
 * back lands on that booking. It is the same back as the back swipe and the
 * Android back button, so the scanner's discard guard sees all of them.
 *
 * Navigating synchronously inside an `Alert` button's `onPress` wedges the
 * navigation transition into an endless render-commit loop (the JS thread
 * stays busy and network callbacks starve). The navigation therefore runs on
 * the next frame, outside the button handler, from alerts and buttons alike.
 */
export function returnToBooking(): void {
  requestAnimationFrame(() => {
    router.back();
  });
}

/**
 * How the in-app browser looks: a sheet over the screen the person tapped
 * on (iOS), with Shelf orange on its controls (iOS) or toolbar (Android),
 * the page title shown, and reader mode off so a page opens as published.
 * Dismissing it returns to that screen exactly as it was.
 */
const IN_APP_BROWSER_OPTIONS: WebBrowser.WebBrowserOpenOptions = {
  presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  controlsColor: lightColors.primary,
  dismissButtonStyle: "close",
  readerMode: false,
  enableBarCollapsing: true,
  // why: Android only. On iOS `toolbarColor` is the bar background, and an
  // orange bar under orange controls would hide them; iOS keeps its system
  // bar (light or dark) with orange controls instead.
  ...(Platform.OS === "android" ? { toolbarColor: lightColors.primary } : {}),
  showTitle: true,
  enableDefaultShareMenuItem: true,
};

/**
 * Open a web page in the in-app browser (SFSafariViewController on iOS, a
 * Custom Tab on Android). Files behind a URL (PDF, images, Office documents)
 * open in it too, with no download step.
 *
 * Use this, NOT `Linking.openURL`, for every web page the app opens. On
 * Android, `Linking.openURL` of a *verified* app-link (`app.shelf.nu/qr`,
 * `/assets`, `/bookings`, `/audits`) is re-intercepted by the system and
 * re-launches this app, so a deep link that falls back to its own web URL
 * would loop straight back into the failing handler. An in-app browser
 * renders the page directly without re-triggering link interception, making
 * web fallbacks loop-safe on both platforms.
 *
 * A session iOS never released (see `./browser-lock.ts`) is released and
 * the page opened once more, so a link never silently opens nothing. A
 * second tap while the first page is still being presented joins that open
 * (`joinOpensInFlight`), so a double tap never closes and reopens the
 * browser.
 *
 * @param url - the absolute http(s) URL to open
 * @returns the `WebBrowser.openBrowserAsync` result, once the browser is
 *   dismissed
 */
export const openShelfWebUrl: (
  url: string
) => Promise<WebBrowser.WebBrowserResult> = joinOpensInFlight((url) =>
  openPastStaleLock(
    () => WebBrowser.openBrowserAsync(url, IN_APP_BROWSER_OPTIONS),
    () => WebBrowser.dismissBrowser(),
    WebBrowser.WebBrowserResultType.LOCKED
  )
);
