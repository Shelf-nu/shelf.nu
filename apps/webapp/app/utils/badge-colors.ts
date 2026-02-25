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
    text: "#E76F51",
  },
  red: {
    bg: "#FFEBEE",
    text: "#C62828",
  },
  amber: {
    bg: "#FFF8E1",
    text: "#A66E00",
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
    text: "#D81B60",
  },
  brown: {
    bg: "#FFE0B2",
    text: "#A85E32",
  },
} as const;
