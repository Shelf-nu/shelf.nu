import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  lightColors,
  darkColors,
  lightStatusBadge,
  darkStatusBadge,
  lightBookingStatusBadge,
  darkBookingStatusBadge,
  lightAuditStatusBadge,
  darkAuditStatusBadge,
  lightAuditAssetStatusBadge,
  darkAuditAssetStatusBadge,
  lightStatusColors,
  darkStatusColors,
  lightShadows,
  darkShadows,
  type Colors,
  type Shadows,
} from "./theme-colors";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThemePreference = "light" | "dark" | "system";

export interface ThemeState {
  /** User preference: light, dark, or follow system */
  themePreference: ThemePreference;
  /** Change the stored preference */
  setThemePreference: (pref: ThemePreference) => void;
  /** Resolved boolean — true when the active scheme is dark */
  isDark: boolean;
  /** Active color palette */
  colors: Colors;
  /** Active status badge map */
  statusBadge: Record<string, { bg: string; text: string }>;
  /** Active booking status badge map */
  bookingStatusBadge: Record<string, { bg: string; text: string }>;
  /** Active audit session status badge map */
  auditStatusBadge: Record<string, { bg: string; text: string }>;
  /** Active audit asset status badge map */
  auditAssetStatusBadge: Record<string, { bg: string; text: string }>;
  /** Legacy status color map (text color only) */
  statusColors: Record<string, string>;
  /** Active shadow presets */
  shadows: Shadows;
}

// ─── Storage key ────────────────────────────────────────────────────────────

const THEME_KEY = "shelf_theme_preference";

// ─── Context ────────────────────────────────────────────────────────────────

const defaultState: ThemeState = {
  themePreference: "system",
  setThemePreference: () => {},
  isDark: false,
  colors: lightColors,
  statusBadge: lightStatusBadge,
  bookingStatusBadge: lightBookingStatusBadge,
  auditStatusBadge: lightAuditStatusBadge,
  auditAssetStatusBadge: lightAuditAssetStatusBadge,
  statusColors: lightStatusColors,
  shadows: lightShadows,
};

export const ThemeContext = createContext<ThemeState>(defaultState);

// ─── Provider ───────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // "light" | "dark" | null
  const [themePreference, setPreference] = useState<ThemePreference>("system");

  // Restore persisted preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreference(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setThemePreference = useCallback((pref: ThemePreference) => {
    setPreference(pref);
    AsyncStorage.setItem(THEME_KEY, pref).catch(() => {});
  }, []);

  // Resolve effective dark/light
  const isDark =
    themePreference === "dark" ||
    (themePreference === "system" && systemScheme === "dark");

  const value = useMemo<ThemeState>(
    () => ({
      themePreference,
      setThemePreference,
      isDark,
      colors: isDark ? darkColors : lightColors,
      statusBadge: isDark ? darkStatusBadge : lightStatusBadge,
      bookingStatusBadge: isDark
        ? darkBookingStatusBadge
        : lightBookingStatusBadge,
      auditStatusBadge: isDark ? darkAuditStatusBadge : lightAuditStatusBadge,
      auditAssetStatusBadge: isDark
        ? darkAuditAssetStatusBadge
        : lightAuditAssetStatusBadge,
      statusColors: isDark ? darkStatusColors : lightStatusColors,
      shadows: isDark ? darkShadows : lightShadows,
    }),
    [themePreference, setThemePreference, isDark]
  );

  // Always render children — returning null here would break Expo Router's
  // navigation tree and cause an RTCFatal crash. We start with "system" default
  // which is correct most of the time, and update once AsyncStorage resolves.
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
