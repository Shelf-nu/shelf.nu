/**
 * What tapping and long-pressing a link does, everywhere the app shows one.
 *
 * - Tap (`openLink`, or `useLinkHandlers` in a component): a Shelf link the
 *   app has a screen for opens that screen; a Shelf QR link resolves to its
 *   asset or kit without recording a scan; any other page of the connected
 *   Shelf server gets a notice that it is on the web app (with Copy link),
 *   never the in-app browser, which would only show the web login; every
 *   other web page or file opens in the in-app browser. The rule lives in
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
import { useMemo } from "react";
import * as Haptics from "expo-haptics";
import { resolveQrAndNavigate } from "./deep-links";
import { openShelfWebUrl, pushIntoTab } from "./navigation";
import {
  resolveLinkOpening,
  type LinkContext,
  type WebOnlyReason,
} from "./open-link";
import { useOrg } from "./org-context";
import { getActiveServer } from "./server/active-server";

/** The part of React Native's `Clipboard` native module the menu uses. */
interface ClipboardModule extends TurboModule {
  setString(content: string): void;
}

const clipboard = TurboModuleRegistry.get<ClipboardModule>("Clipboard");

/** What a link does beyond its role, for screen readers. */
export const LINK_HINT = "Opens the link. Long-press to copy or share it.";

/** What the web-only notice says, per reason. */
const WEB_ONLY_NOTICE: Readonly<
  Record<WebOnlyReason, { title: string; message: string }>
> = {
  "no-screen": {
    title: "Only on the web app",
    message:
      "This page is not in the app. Copy the link to open it in a browser where you are signed in to Shelf.",
  },
  "other-workspace": {
    title: "In another workspace",
    message:
      "This link is to a different workspace. Switch to that workspace to open it, or copy the link.",
  },
};

/**
 * Explains that a Shelf page lives on the web app only, offering to copy the
 * link.
 *
 * @param url - The link's absolute URL.
 * @param reason - Why the app cannot open it.
 */
function showWebOnlyNotice(url: string, reason: WebOnlyReason) {
  const { title, message } = WEB_ONLY_NOTICE[reason];
  Alert.alert(title, message, [
    ...(clipboard ? [{ text: "Copy link", onPress: () => copyLink(url) }] : []),
    { text: "OK", style: "cancel" as const },
  ]);
}

/**
 * Opens a link where it belongs: an app screen, a resolved QR code, a
 * web-only notice, or the in-app browser.
 *
 * Never throws: a link that fails to open (or a second tap while the browser
 * is already showing) leaves the screen as it was.
 *
 * @param url - The link's absolute URL.
 * @param context - Where the link was tapped (the workspace on show).
 * @param leave - Runs before an app screen opens, for a link inside a modal:
 *   it closes the modal so the screen is not hidden behind it.
 * @returns Resolves once the link has been handed off, or immediately when
 *   there is nothing to open or opening failed
 */
export async function openLink(
  url: string,
  context: LinkContext = {},
  leave?: () => void
): Promise<void> {
  const opening = resolveLinkOpening(url, getActiveServer().baseUrl, context);
  if (!opening) return;
  try {
    switch (opening.opener) {
      case "screen":
        leave?.();
        pushIntoTab(opening.tabRoot, opening.href ?? undefined);
        return;
      case "qr":
        leave?.();
        // A tapped link is not a scan of the label: record nothing.
        await resolveQrAndNavigate(opening.qrId, opening.origin, {
          recordScan: false,
          orgId: context.currentOrgId ?? undefined,
        });
        return;
      case "web-only":
        showWebOnlyNotice(opening.url, opening.reason);
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

/** The tap and long-press handlers for links on one screen or modal. */
export type LinkHandlers = {
  readonly open: (url: string) => void;
  readonly showMenu: (url: string) => void;
};

/**
 * Link handlers that know the workspace the app is showing, so a link to
 * another workspace explains itself instead of opening a screen that cannot
 * find it.
 *
 * @param options - Component options.
 * @param options.onLeave - For links inside a React Native `Modal`: closes
 *   the modal before a Shelf link opens its app screen underneath.
 * @returns Stable `open` and `showMenu` handlers.
 */
export function useLinkHandlers({
  onLeave,
}: { onLeave?: () => void } = {}): LinkHandlers {
  const currentOrgId = useOrg().currentOrg?.id ?? null;
  return useMemo(
    () => ({
      open: (url: string) => void openLink(url, { currentOrgId }, onLeave),
      showMenu: showLinkMenu,
    }),
    [currentOrgId, onLeave]
  );
}
