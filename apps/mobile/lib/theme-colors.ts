/**
 * Light + Dark color palettes for the Shelf companion app.
 *
 * Both objects share the same keys so they can be swapped at runtime
 * via the ThemeProvider. Status-badge and shadow maps are also duplicated
 * per theme for convenience.
 */

// ────────────────────────────── Light palette ──────────────────────────────

export const lightColors = {
  // Brand — Shelf orange
  primary: "#EF6820",
  primaryLight: "#F38744",
  primaryBg: "#FEF6EE",
  primaryForeground: "#FFFFFF",

  // Neutrals — Gray scale from webapp
  white: "#FFFFFF",
  background: "#FFFFFF",
  backgroundSecondary: "#FCFCFD", // gray-25
  backgroundTertiary: "#F9FAFB", // gray-50
  foreground: "#101828", // gray-900
  foregroundSecondary: "#3E4A5C", // gray-600 — WCAG AA 5.1:1
  muted: "#576274", // gray-500 — WCAG AA 5.0:1
  mutedLight: "#6F7A8B", // gray-400 — WCAG AA 4.0:1 (icons/large text)
  border: "#EAECF0", // gray-200
  borderLight: "#F2F4F7", // gray-100
  gray700: "#344054",
  gray800: "#1D2939",
  gray300: "#D0D5DD",

  // Status — from webapp badge color schemes
  available: "#2E7D32",
  availableBg: "#E8F5E9",
  inCustody: "#01579B",
  inCustodyBg: "#E1F5FE",
  checkedOut: "#8E24AA",
  checkedOutBg: "#F3E5F5",

  // Semantic
  error: "#F04438",
  errorBg: "#FEF3F2",
  errorBorder: "#FDA29B",
  warning: "#F79009",
  warningBg: "#FFFAEB",
  success: "#12B76A",
  successBg: "#ECFDF3",

  // Placeholder text — dedicated token for input placeholders (3.6:1 on white)
  placeholderText: "#767F8D",

  // Overlays
  overlayDark: "rgba(0,0,0,0.4)",
};

/** Shared type — both palettes have the same keys with string values */
export type Colors = { [K in keyof typeof lightColors]: string };

// ────────────────────────────── Dark palette ───────────────────────────────

export const darkColors: Colors = {
  // Brand — slightly brighter orange for dark backgrounds
  primary: "#FF8C42",
  primaryLight: "#FFA566",
  primaryBg: "#2A1B0E",
  primaryForeground: "#FFFFFF",

  // Neutrals — GitHub-style dark palette
  white: "#161B22", // "white" becomes the card/surface color in dark mode
  background: "#0D1117",
  backgroundSecondary: "#161B22",
  backgroundTertiary: "#1C2128",
  foreground: "#E6EDF3",
  foregroundSecondary: "#A8B5C4",
  muted: "#8B949E",
  mutedLight: "#6E7681",
  border: "#30363D",
  borderLight: "#21262D",
  gray700: "#C9D1D9",
  gray800: "#E6EDF3",
  gray300: "#484F58",

  // Status — brighter for dark backgrounds
  available: "#3FB950",
  availableBg: "#0D2818",
  inCustody: "#58A6FF",
  inCustodyBg: "#0D1D31",
  checkedOut: "#D2A8FF",
  checkedOutBg: "#271535",

  // Semantic — brighter for dark backgrounds
  error: "#F85149",
  errorBg: "#2D1214",
  errorBorder: "#A84040",
  warning: "#F0A020",
  warningBg: "#2E200A",
  success: "#3FB950",
  successBg: "#0D2818",

  // Placeholder text — reuse mutedLight for dark mode (already compliant)
  placeholderText: "#6E7681",

  // Overlays — slightly more opaque on dark
  overlayDark: "rgba(0,0,0,0.6)",
};

// ────────────────────────── Status badge maps ──────────────────────────────

function buildStatusBadge(c: Colors) {
  return {
    AVAILABLE: { bg: c.availableBg, text: c.available },
    IN_CUSTODY: { bg: c.inCustodyBg, text: c.inCustody },
    CHECKED_OUT: { bg: c.checkedOutBg, text: c.checkedOut },
  } as Record<string, { bg: string; text: string }>;
}

function buildBookingStatusBadge(c: Colors) {
  return {
    DRAFT: { bg: c.borderLight, text: c.gray700 },
    RESERVED: { bg: c.inCustodyBg, text: c.inCustody },
    ONGOING: { bg: c.checkedOutBg, text: c.checkedOut },
    OVERDUE: { bg: c.errorBg, text: c.error },
    COMPLETE: { bg: c.successBg, text: c.success },
    ARCHIVED: { bg: c.borderLight, text: c.muted },
    CANCELLED: { bg: c.borderLight, text: c.muted },
  } as Record<string, { bg: string; text: string }>;
}

export const lightStatusBadge = buildStatusBadge(lightColors);
export const darkStatusBadge = buildStatusBadge(darkColors);

export const lightBookingStatusBadge = buildBookingStatusBadge(lightColors);
export const darkBookingStatusBadge = buildBookingStatusBadge(darkColors);

function buildAuditStatusBadge(c: Colors) {
  return {
    PENDING: { bg: c.warningBg, text: c.warning },
    ACTIVE: { bg: c.inCustodyBg, text: c.inCustody },
    COMPLETED: { bg: c.successBg, text: c.success },
    CANCELLED: { bg: c.borderLight, text: c.muted },
  } as Record<string, { bg: string; text: string }>;
}

function buildAuditAssetStatusBadge(c: Colors) {
  return {
    PENDING: { bg: c.borderLight, text: c.muted },
    FOUND: { bg: c.successBg, text: c.success },
    MISSING: { bg: c.errorBg, text: c.error },
    UNEXPECTED: { bg: c.warningBg, text: c.warning },
  } as Record<string, { bg: string; text: string }>;
}

export const lightAuditStatusBadge = buildAuditStatusBadge(lightColors);
export const darkAuditStatusBadge = buildAuditStatusBadge(darkColors);
export const lightAuditAssetStatusBadge =
  buildAuditAssetStatusBadge(lightColors);
export const darkAuditAssetStatusBadge = buildAuditAssetStatusBadge(darkColors);

/** Legacy helper — returns text color only */
function buildStatusColors(c: Colors) {
  return {
    AVAILABLE: c.available,
    IN_CUSTODY: c.inCustody,
    CHECKED_OUT: c.checkedOut,
  } as Record<string, string>;
}

export const lightStatusColors = buildStatusColors(lightColors);
export const darkStatusColors = buildStatusColors(darkColors);

// ────────────────────────────── Shadows ─────────────────────────────────────

type ShadowDef = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type Shadows = { sm: ShadowDef; md: ShadowDef; lg: ShadowDef };

export const lightShadows: Shadows = {
  sm: {
    shadowColor: "#101828",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#101828",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: "#101828",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
};

/** Dark mode: minimal shadows — rely on border + surface elevation */
export const darkShadows: Shadows = {
  sm: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
};
