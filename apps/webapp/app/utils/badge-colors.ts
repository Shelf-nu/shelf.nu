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
    // Darkened to meet WCAG AA. #E76F51 was 2.82:1 on this background —
    // below even the 3:1 large-text floor. #B54708 (5.0:1) is the shade the
    // rest of the design system already uses for brand-orange text.
    text: "#B54708",
  },
  red: {
    bg: "#FFEBEE",
    text: "#C62828",
  },
  amber: {
    bg: "#FFF8E1",
    // Darkened to meet WCAG AA. #A66E00 was 4.07:1 on this background.
    // #92400E (6.7:1) is the same hex the companion app uses for amber badge
    // text, so the two apps now match on the `warning` tone as well.
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
    text: "#01579B", // Darkened to meet WCAG AA (4.5:1 contrast ratio)
  },
  violet: {
    bg: "#F3E5F5",
    text: "#8E24AA",
  },
  pink: {
    bg: "#FCE4EC",
    // Darkened to meet WCAG AA. #D81B60 was 4.11:1 on this background —
    // close enough to the bar that only a measurement catches it, which is
    // why the palette-wide test in color-contrast.test.ts now covers every
    // entry rather than a hand-picked few. #AD1457 is 5.8:1.
    text: "#AD1457",
  },
  brown: {
    bg: "#FFE0B2",
    // Darkened to meet WCAG AA. #A85E32 was 3.84:1 on this background.
    text: "#8A4A22",
  },
} as const;
