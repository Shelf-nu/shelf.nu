/**
 * Start page preference — lets users choose which tab opens on app launch.
 * Follows the same AsyncStorage persistence pattern as theme-context.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StartPage = "home" | "assets" | "scanner" | "bookings";

// ─── Constants ──────────────────────────────────────────────────────────────

const START_PAGE_KEY = "shelf_start_page";

const DEFAULT_START_PAGE: StartPage = "assets";

const ROUTE_MAP: Record<StartPage, string> = {
  home: "/(tabs)/home",
  assets: "/(tabs)/assets",
  scanner: "/(tabs)/scanner",
  bookings: "/(tabs)/bookings",
};

export const START_PAGE_OPTIONS: {
  key: StartPage;
  label: string;
  icon: "home-outline" | "cube-outline" | "scan" | "calendar-outline";
}[] = [
  { key: "home", label: "Home", icon: "home-outline" },
  { key: "assets", label: "Assets", icon: "cube-outline" },
  { key: "scanner", label: "Scan", icon: "scan" },
  { key: "bookings", label: "Bookings", icon: "calendar-outline" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read the persisted start page (returns default if none set). */
export async function getStartPage(): Promise<StartPage> {
  try {
    const stored = await AsyncStorage.getItem(START_PAGE_KEY);
    if (stored && stored in ROUTE_MAP) return stored as StartPage;
  } catch {}
  return DEFAULT_START_PAGE;
}

/** Map a start page key to its Expo Router path. */
export function getStartPageRoute(page: StartPage): string {
  return ROUTE_MAP[page] ?? ROUTE_MAP[DEFAULT_START_PAGE];
}

/** Persist the user's start page choice. */
export async function setStartPage(page: StartPage): Promise<void> {
  try {
    await AsyncStorage.setItem(START_PAGE_KEY, page);
  } catch {}
}
