/**
 * Screen orientation: phones stay upright, tablets rotate.
 *
 * iOS states this per device family in `ios/Shelf/Info.plist`
 * (`UISupportedInterfaceOrientations` is portrait for iPhone, the `~ipad`
 * variant lists all four), so it needs nothing at runtime.
 *
 * Android has one manifest setting for every device, and `app.json` keeps it at
 * portrait so a phone never shows its splash sideways. A tablet unlocks here,
 * on launch. Android 16 already ignores the portrait lock on large screens for
 * apps targeting it; this brings older tablets to the same behaviour.
 *
 * @see lib/content-column.ts for what counts as a tablet
 */

import { Dimensions, Platform } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { isTabletScreen } from "@/lib/content-column";

/**
 * Lets an Android tablet follow its rotation. No-op on phones and on iOS.
 * Judged from the physical screen, not the window, so a tablet in split screen
 * still counts as a tablet.
 */
export function unlockOrientationOnTablets(): void {
  if (Platform.OS !== "android") return;

  const { width, height } = Dimensions.get("screen");
  if (!isTabletScreen(width, height)) return;

  // why: a failure only leaves the manifest's portrait lock in place, which
  // is the app's long-standing behaviour, so there is nothing to recover.
  ScreenOrientation.unlockAsync().catch(() => undefined);
}
