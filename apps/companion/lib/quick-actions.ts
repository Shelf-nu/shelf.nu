import { useEffect } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
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

/**
 * Set once the launch action has been read, so a re-run of the hook (a new
 * router instance) never opens it a second time.
 */
let launchActionTaken = false;

export function useQuickActions() {
  const router = useRouter();

  // Register quick action items on mount
  useEffect(() => {
    QuickActions.setItems(QUICK_ACTION_ITEMS);
  }, []);

  // Listen first, then take the action that launched the app. iOS delivers a
  // launch action either before JS listens (kept native-side, returned by
  // takePendingActionAsync) or after (sent to the listener), so in that order
  // every action arrives exactly once. `QuickActions.initial` covers launches
  // outside the scene life cycle.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const subscription = QuickActions.addListener((action) => {
      if (action?.params?.route) {
        router.push(action.params.route as any);
      }
    });

    const launchAction = launchActionTaken
      ? Promise.resolve(null)
      : QuickActions.initial
      ? Promise.resolve(QuickActions.initial)
      : QuickActions.takePendingActionAsync();
    launchActionTaken = true;
    launchAction
      .then((action) => {
        const route = action?.params?.route;
        if (cancelled || !route) return;
        // Small delay to let the navigation mount settle on cold start
        timer = setTimeout(() => {
          router.push(route as any);
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
