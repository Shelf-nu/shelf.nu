import { router, type Href } from "expo-router";

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
