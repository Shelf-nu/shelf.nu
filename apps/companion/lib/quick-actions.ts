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

export function useQuickActions() {
  const router = useRouter();

  // Register quick action items on mount
  useEffect(() => {
    QuickActions.setItems(QUICK_ACTION_ITEMS);
  }, []);

  // Handle cold-start: check if app was opened via a quick action
  useEffect(() => {
    const initial = QuickActions.initial;
    if (initial?.params?.route) {
      // Small delay to let the navigation mount settle on cold start
      const timer = setTimeout(() => {
        router.push(initial.params!.route as any);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [router]);

  // Handle warm-start: listen for quick actions while the app is already running
  useEffect(() => {
    const subscription = QuickActions.addListener((action) => {
      if (action?.params?.route) {
        router.push(action.params.route as any);
      }
    });

    return () => subscription.remove();
  }, [router]);
}
