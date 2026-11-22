/**
 * Options for a tab that has screens but no button in the tab bar.
 *
 * Audits and Custody are reached from other screens (the Home tiles, a deep
 * link, a push notification), never from the tab bar. They still have to be
 * ordinary tabs: expo-router sends the user back to the start tab whenever
 * the focused tab is hidden, and `href: null` is one way of hiding it. So a
 * tab like this stays an ordinary tab and only its slot in the tab bar is
 * removed.
 *
 * Do not use `href: null` (or `hidden: true`) on a tab the app navigates to.
 *
 * @see {@link file://./../app/(tabs)/_layout.tsx} the tabs that spread it
 */

/** The tab-bar options {@link TAB_WITHOUT_BUTTON} sets. */
type TabWithoutButtonOptions = {
  tabBarItemStyle: { display: "none"; width: number };
};

/**
 * Spread into a `Tabs.Screen`'s options to keep the tab navigable while
 * leaving it out of the tab bar and the tablet sidebar.
 *
 * - `display: "none"` removes the tab's slot, not just its button. The tab
 *   bar wraps every button in a slot that shares the bar's width, so a button
 *   that merely renders nothing leaves an empty slot and squeezes the labels
 *   of the other tabs.
 * - `width: 0` is for the tab bar's own arithmetic: it adds up every tab's
 *   width to decide whether labels fit beside the icons on a wide window, and
 *   a tab with no slot must not count towards that sum.
 */
export const TAB_WITHOUT_BUTTON: TabWithoutButtonOptions = {
  tabBarItemStyle: { display: "none", width: 0 },
};
