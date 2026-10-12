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
 * `expo-screen-orientation` is a native module, and this file runs from the
 * root layout on every launch, so it is required lazily: an over-the-air bundle
 * that reaches a build whose binary predates the module keeps the portrait lock
 * instead of failing at import time.
 *
 * @see lib/content-column.ts for what counts as a tablet
 * @see EAS-UPDATE.md for which builds an over-the-air bundle reaches
 */

import { Dimensions, Platform } from "react-native";
import { isTabletScreen } from "@/lib/content-column";

/**
 * Lets an Android tablet follow its rotation. No-op on phones, on iOS, and on
 * a build without the native orientation module.
 * Judged from the physical screen, not the window, so a tablet in split screen
 * still counts as a tablet.
 */
export function unlockOrientationOnTablets(): void {
  if (Platform.OS !== "android") return;

  const { width, height } = Dimensions.get("screen");
  if (!isTabletScreen(width, height)) return;

  let ScreenOrientation: typeof import("expo-screen-orientation");
  try {
    // why: a static import throws "Cannot find native module" while the
    // bundle loads on a binary without the module, which stops the app at
    // launch; requiring it here keeps that failure inside this try.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ScreenOrientation = require("expo-screen-orientation");
  } catch {
    return;
  }

  // why: a failure only leaves the manifest's portrait lock in place, which
  // is the app's long-standing behaviour, so there is nothing to recover.
  ScreenOrientation.unlockAsync().catch(() => undefined);
}
