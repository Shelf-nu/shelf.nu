/**
 * Badge color palette
 * Predefined accessible color combinations for status badges
 */

export type BadgeColorScheme = {
  bg: string;
  text: string;
};

export const BADGE_COLORS = {
  gray: {
    bg: "#F8F9FA",
    text: "#343A40",
  },
  orange: {
    bg: "#FFF3E0",
    // 5.0:1 on this background, and the design system's brand-orange text
    // shade. Badge text is 12px, so the 3:1 large-text allowance does not
    // apply here — keep any replacement at 4.5:1 or above.
    text: "#B54708",
  },
  red: {
    bg: "#FFEBEE",
    text: "#C62828",
  },
  amber: {
    bg: "#FFF8E1",
    // 6.7:1 on this background, and the same hex the companion uses for its
    // amber badge text. The two apps must render the `warning` tone
    // identically: change both or neither.
    text: "#92400E",
  },
  green: {
    bg: "#E8F5E9",
    text: "#2E7D32",
  },
  indigo: {
    bg: "#E8EAF6",
    text: "#3949AB",
  },
  blue: {
    bg: "#E1F5FE",
    text: "#01579B", // 4.5:1 on this background — the floor for 12px text
  },
  violet: {
    bg: "#F3E5F5",
    text: "#8E24AA",
  },
  pink: {
    bg: "#FCE4EC",
    // 5.8:1 on this background. color-contrast.test.ts asserts every entry
    // in this map against 4.5:1 — measure before changing one, because a
    // shade that merely looks dark enough is not.
    text: "#AD1457",
  },
  brown: {
    bg: "#FFE0B2",
    // 5.4:1 on this background.
    text: "#8A4A22",
  },
} as const;
