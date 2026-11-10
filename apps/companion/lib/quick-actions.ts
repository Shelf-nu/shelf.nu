/**
 * Home-screen quick actions (long-press the app icon): the shortcut list, and
 * the hook that opens the screen a shortcut names.
 *
 * On iOS the action that launches the app comes from the patched
 * expo-quick-actions (`takePendingActionAsync`, see
 * `patches/expo-quick-actions@6.0.1.patch`), because under the UIKit scene
 * life cycle it can arrive before JS listens.
 *
 * @see {@link file://./../app/_layout.tsx} where the hook is mounted
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter, type Href } from "expo-router";
import * as QuickActions from "expo-quick-actions";

// ── Quick action definitions (iOS limits to 4) ─────────────────────

const QUICK_ACTION_ITEMS: QuickActions.Action[] = [
  {
    id: "scan_qr",
    title: "Scan QR Code",
    icon: Platform.OS === "ios" ? "symbol:qrcode.viewfinder" : undefined,
    params: { route: "/(tabs)/scanner" },
  },
  {
    id: "view_assets",
    title: "View Assets",
    icon: Platform.OS === "ios" ? "symbol:cube" : undefined,
    params: { route: "/(tabs)/assets" },
  },
  {
    id: "bookings",
    title: "Bookings",
    icon: Platform.OS === "ios" ? "symbol:calendar" : undefined,
    params: { route: "/(tabs)/bookings" },
  },
  {
    id: "audits",
    title: "Audits",
    icon: Platform.OS === "ios" ? "symbol:checklist" : undefined,
    params: { route: "/(tabs)/audits" },
  },
];

// ── Hook: register items + handle cold/warm start ──────────────────

/** Where the action that launched the app can be read from. */
type LaunchActionSource = {
  /** The launch action outside the scene life cycle, if any. */
  initial: QuickActions.Action | undefined;
  /** Takes the launch action that arrived before JS listened (iOS scenes). */
  takePending: () => Promise<QuickActions.Action | null>;
};

/** The action that launched the app, until it has been opened. */
export type LaunchAction = {
  /** Resolves the launch action, or null once it has been opened. */
  read: () => Promise<QuickActions.Action | null>;
  /** Records that the launch action was opened, so it is never opened again. */
  markOpened: () => void;
};

/**
 * Holds the action that launched the app. The source is asked once, and the
 * action stays readable until `markOpened`, so a hook run that is cancelled
 * before navigating leaves it for the next run.
 *
 * @param source - where the launch action comes from
 * @returns the launch action holder
 */
export function createLaunchAction(source: LaunchActionSource): LaunchAction {
  let pending: Promise<QuickActions.Action | null> | null = null;
  let opened = false;
  return {
    read: () => {
      if (opened) return Promise.resolve(null);
      pending ??= source.initial
        ? Promise.resolve(source.initial)
        : source.takePending();
      return pending;
    },
    markOpened: () => {
      opened = true;
    },
  };
}

/** The app's launch action, opened once per app process. */
const launchAction = createLaunchAction({
  initial: QuickActions.initial,
  takePending: () => QuickActions.takePendingActionAsync(),
});

/**
 * Registers the shortcuts and opens the screen a shortcut names.
 *
 * Mount once, under the router (the root layout). Shortcuts picked while the
 * app runs arrive through the listener. The shortcut that launched the app is
 * opened once per app process, a short moment after mount so navigation has
 * settled.
 */
export function useQuickActions() {
  const router = useRouter();

  // Register quick action items on mount
  useEffect(() => {
    QuickActions.setItems(QUICK_ACTION_ITEMS);
  }, []);

  // The action that launched the app reaches JS once, as the launch action
  // (taken from native) or through the listener (native sends it when JS starts
  // observing, or when it arrives after that), whichever happens first.
  // `QuickActions.initial` covers launches outside the scene life cycle.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const subscription = QuickActions.addListener((action) => {
      if (action?.params?.route) {
        router.push(String(action.params.route) as Href);
      }
    });

    launchAction
      .read()
      .then((action) => {
        const route = action?.params?.route;
        if (cancelled || !route) return;
        // Small delay to let the navigation mount settle on cold start
        timer = setTimeout(() => {
          launchAction.markOpened();
          router.push(String(route) as Href);
        }, 300);
      })
      .catch(() => {
        // A failed lookup only costs the launch shortcut; the app still opens.
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [router]);
}
