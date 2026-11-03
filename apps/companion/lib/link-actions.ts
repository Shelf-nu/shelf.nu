/**
 * What tapping and long-pressing a link does, everywhere the app shows one.
 *
 * - Tap (`openLink`): a Shelf link the app has a screen for opens that
 *   screen; a Shelf QR link resolves to its asset or kit; every other web
 *   page or file opens in the in-app browser. The rule lives in
 *   `./open-link.ts`.
 * - Long-press (`showLinkMenu`): a menu with the URL as its title and Copy
 *   link and Share, the platform's own action sheet on iOS and an alert on
 *   Android.
 *
 * Copy uses React Native's built-in clipboard module, which every Companion
 * binary ships, through `TurboModuleRegistry` (the `Clipboard` export of
 * `react-native` warns that it moved to a community package). When a build
 * has no clipboard module, the menu offers Share only.
 *
 * @see {@link file://./open-link.ts} `resolveLinkOpening`
 * @see {@link file://../components/links/linked-text.tsx}
 * @see {@link file://../components/links/link-chip.tsx}
 */
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Share,
  ToastAndroid,
  TurboModuleRegistry,
  type TurboModule,
} from "react-native";
import * as Haptics from "expo-haptics";
import { resolveQrAndNavigate } from "./deep-links";
import { openShelfWebUrl, pushIntoTab } from "./navigation";
import { resolveLinkOpening } from "./open-link";
import { getActiveServer } from "./server/active-server";

/** The part of React Native's `Clipboard` native module the menu uses. */
interface ClipboardModule extends TurboModule {
  setString(content: string): void;
}

const clipboard = TurboModuleRegistry.get<ClipboardModule>("Clipboard");

/**
 * Opens a link where it belongs: an app screen, a resolved QR code, or the
 * in-app browser.
 *
 * Never throws: a link that fails to open (or a second tap while the browser
 * is already showing) leaves the screen as it was.
 *
 * @param url - The link's absolute URL.
 * @returns Resolves once the link has been handed off, or immediately when
 *   there is nothing to open or opening failed
 */
export async function openLink(url: string): Promise<void> {
  const opening = resolveLinkOpening(url, getActiveServer().baseUrl);
  if (!opening) return;
  try {
    switch (opening.opener) {
      case "screen":
        pushIntoTab(opening.tabRoot, opening.href ?? undefined);
        return;
      case "qr":
        await resolveQrAndNavigate(opening.qrId, opening.origin);
        return;
      case "browser":
        await openShelfWebUrl(opening.url);
        return;
    }
  } catch {
    // Non-fatal by design: the screen stays as it was and the person can tap
    // the link again.
  }
}

/** Copies the URL and confirms it with a haptic (iOS) or a toast (Android). */
function copyLink(url: string) {
  clipboard?.setString(url);
  if (Platform.OS === "android") {
    ToastAndroid.show("Link copied", ToastAndroid.SHORT);
  } else {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

/** Opens the platform share sheet for the URL. */
function shareLink(url: string) {
  // iOS shares a `url` as a link (AirDrop, Messages previews); Android's share
  // intent only carries text.
  void Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(
    () => {
      // Dismissed or unavailable: nothing to undo.
    }
  );
}

/**
 * Shows the long-press menu for a link: Copy link and Share, titled with the
 * URL so the person sees where it goes before acting on it.
 *
 * @param url - The link's absolute URL.
 */
export function showLinkMenu(url: string): void {
  const actions = [
    ...(clipboard ? [{ label: "Copy link", run: () => copyLink(url) }] : []),
    { label: "Share", run: () => shareLink(url) },
  ];

  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: url,
        options: [...actions.map((action) => action.label), "Cancel"],
        cancelButtonIndex: actions.length,
      },
      (index) => actions[index]?.run()
    );
    return;
  }

  Alert.alert(url, undefined, [
    { text: "Cancel", style: "cancel" },
    ...actions.map((action) => ({ text: action.label, onPress: action.run })),
  ]);
}
