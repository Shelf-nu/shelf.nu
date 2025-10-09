/* eslint-disable no-console */
import { describe, it, expect } from "vitest";
import {
  getContrastRatio,
  meetsWCAG_AA,
  meetsWCAG_AAA,
  hexToRgb,
  getLuminance,
  overlayColor,
  getAccessibleTextColor,
  darkenColor,
} from "./color-contrast";

describe("Color Contrast Utilities", () => {
  describe("hexToRgb", () => {
    it("should convert hex to RGB", () => {
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#EF6820")).toEqual({ r: 239, g: 104, b: 32 });
    });

    it("should handle hex colors without # prefix", () => {
      expect(hexToRgb("ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    });

    it("should throw error for invalid hex", () => {
      expect(() => hexToRgb("invalid")).toThrow();
    });
  });

  describe("getLuminance", () => {
    it("should calculate luminance for white", () => {
      const lum = getLuminance({ r: 255, g: 255, b: 255 });
      expect(lum).toBeCloseTo(1, 2);
    });

    it("should calculate luminance for black", () => {
      const lum = getLuminance({ r: 0, g: 0, b: 0 });
      expect(lum).toBeCloseTo(0, 2);
    });
  });

  describe("getContrastRatio", () => {
    it("should calculate contrast between black and white", () => {
      const ratio = getContrastRatio("#000000", "#ffffff");
      expect(ratio).toBeCloseTo(21, 1);
    });

    it("should calculate contrast between same colors as 1", () => {
      const ratio = getContrastRatio("#ffffff", "#ffffff");
      expect(ratio).toBeCloseTo(1, 1);
    });
  });

  describe("overlayColor", () => {
    it("should overlay color with 30% opacity on white background", () => {
      const result = overlayColor("#2E90FA", "#ffffff", 0.3);
      // Expected: blend of #2E90FA with 30% opacity on white
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    it("should return background color at 0% opacity", () => {
      const result = overlayColor("#2E90FA", "#ffffff", 0);
      expect(result).toBe("#ffffff");
    });

    it("should return foreground color at 100% opacity", () => {
      const result = overlayColor("#2E90FA", "#ffffff", 1);
      expect(result).toBe("#2e90fa");
    });
  });

  describe("getAccessibleTextColor", () => {
    it("should return black for light backgrounds", () => {
      expect(getAccessibleTextColor("#ffffff")).toBe("#000000");
      expect(getAccessibleTextColor("#FFFAEB")).toBe("#000000"); // warning-50
    });

    it("should return white for dark backgrounds", () => {
      expect(getAccessibleTextColor("#000000")).toBe("#ffffff");
      expect(getAccessibleTextColor("#344054")).toBe("#ffffff"); // gray-700
    });
  });

  describe("darkenColor", () => {
    it("should darken a color by reducing RGB values", () => {
      const result = darkenColor("#ffffff", 0.5);
      expect(result).toBe("#808080"); // 255 * 0.5 = 127.5 → 128 (rounded) → 80
    });

    it("should darken blue color", () => {
      const result = darkenColor("#2E90FA", 0.5);
      expect(result).toBe("#17487d"); // Used in Badge component
    });

    it("should handle default factor of 0.5", () => {
      const result = darkenColor("#2E90FA");
      expect(result).toBe("#17487d");
    });

    it("should return original color on parse error", () => {
      const result = darkenColor("invalid");
      expect(result).toBe("invalid");
    });

    it("should handle factor of 1 (no change)", () => {
      const result = darkenColor("#2E90FA", 1);
      expect(result).toBe("#2e90fa");
    });

    it("should handle factor of 0 (black)", () => {
      const result = darkenColor("#2E90FA", 0);
      expect(result).toBe("#000000");
    });
  });

  describe("WCAG Compliance Tests", () => {
    describe("Asset Status Badge Colors", () => {
      // These are the hardcoded colors from asset-status-badge.tsx
      const statusColors = {
        inCustody: "#2E90FA", // Blue
        checkedOut: "#5925DC", // Purple
        available: "#12B76A", // Green
      };

      // The Badge component uses 30% opacity for background and darkened text
      const whiteBackground = "#ffffff";

      it("IN_CUSTODY badge should meet WCAG AA", () => {
        const bgOverlay = overlayColor(
          statusColors.inCustody,
          whiteBackground,
          0.3
        );
        const textColor = darkenColor(statusColors.inCustody, 0.5);
        const ratio = getContrastRatio(textColor, bgOverlay);
        const meetsAA = meetsWCAG_AA(textColor, bgOverlay);

        console.log(
          `IN_CUSTODY: ${textColor} on ${bgOverlay} = ${ratio.toFixed(
            2
          )}:1 (WCAG AA: ${meetsAA ? "✓" : "✗"})`
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(meetsAA).toBe(true);
      });

      it("CHECKED_OUT badge should meet WCAG AA", () => {
        const bgOverlay = overlayColor(
          statusColors.checkedOut,
          whiteBackground,
          0.3
        );
        const textColor = darkenColor(statusColors.checkedOut, 0.5);
        const ratio = getContrastRatio(textColor, bgOverlay);
        const meetsAA = meetsWCAG_AA(textColor, bgOverlay);

        console.log(
          `CHECKED_OUT: ${textColor} on ${bgOverlay} = ${ratio.toFixed(
            2
          )}:1 (WCAG AA: ${meetsAA ? "✓" : "✗"})`
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(meetsAA).toBe(true);
      });

      it("AVAILABLE badge should meet WCAG AA", () => {
        const bgOverlay = overlayColor(
          statusColors.available,
          whiteBackground,
          0.3
        );
        const textColor = darkenColor(statusColors.available, 0.5);
        const ratio = getContrastRatio(textColor, bgOverlay);
        const meetsAA = meetsWCAG_AA(textColor, bgOverlay);

        console.log(
          `AVAILABLE: ${textColor} on ${bgOverlay} = ${ratio.toFixed(
            2
          )}:1 (WCAG AA: ${meetsAA ? "✓" : "✗"})`
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(meetsAA).toBe(true);
      });
    });

    describe("Availability Label (Warning Colors)", () => {
      // From tailwind.config.ts
      const warningColors = {
        bg: "#FFFAEB", // warning-50
        border: "#FEDF89", // warning-200
        text: "#B54708", // warning-700
      };

      it("warning text on warning background should meet WCAG AA", () => {
        const ratio = getContrastRatio(warningColors.text, warningColors.bg);
        const meetsAA = meetsWCAG_AA(warningColors.text, warningColors.bg);

        console.log(
          `Warning badge: ${warningColors.text} on ${
            warningColors.bg
          } = ${ratio.toFixed(2)}:1 (WCAG AA: ${meetsAA ? "✓" : "✗"})`
        );
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(meetsAA).toBe(true);
      });
    });

    describe("Tailwind Color Contrast Information", () => {
      // These tests document color contrast ratios for common Tailwind color combinations
      // NOTE: For WCAG AA compliance, use darker shades (600-800) for text on light backgrounds
      // The color-50 and color-100 backgrounds should pair with color-700 or color-800 text

      it("should document primary color combinations", () => {
        const primaryColor = "#EF6820";
        const primaryBg50 = "#FEF6EE";
        const ratio = getContrastRatio(primaryColor, primaryBg50);

        console.log(
          `ℹ️  Primary-500 on primary-50: ${ratio.toFixed(2)}:1 ${
            ratio >= 4.5 ? "✓" : "✗ - Use primary-700 or primary-800 for text"
          }`
        );

        // This is informational - not all color-500 on color-50 combinations meet WCAG AA
        // Use darker shades for text in production code
        expect(ratio).toBeDefined();
      });

      it("should document success color combinations", () => {
        const successColor = "#12B76A";
        const successBg50 = "#ECFDF3";
        const ratio = getContrastRatio(successColor, successBg50);

        console.log(
          `ℹ️  Success-500 on success-50: ${ratio.toFixed(2)}:1 ${
            ratio >= 4.5 ? "✓" : "✗ - Use success-700 or success-800 for text"
          }`
        );

        expect(ratio).toBeDefined();
      });

      it("should document error color combinations", () => {
        const errorColor = "#F04438";
        const errorBg50 = "#FEF3F2";
        const ratio = getContrastRatio(errorColor, errorBg50);

        console.log(
          `ℹ️  Error-500 on error-50: ${ratio.toFixed(2)}:1 ${
            ratio >= 4.5 ? "✓" : "✗ - Use error-700 or error-800 for text"
          }`
        );

        expect(ratio).toBeDefined();
      });
    });
  });

  describe("meetsWCAG_AA", () => {
    it("should pass for high contrast", () => {
      expect(meetsWCAG_AA("#000000", "#ffffff")).toBe(true);
    });

    it("should fail for low contrast", () => {
      expect(meetsWCAG_AA("#cccccc", "#ffffff")).toBe(false);
    });

    it("should use different threshold for large text", () => {
      // Some combinations pass large text but not normal text
      const fg = "#777777";
      const bg = "#ffffff";
      const ratio = getContrastRatio(fg, bg);

      // If ratio is between 3.0 and 4.5, it should pass large but not normal
      if (ratio >= 3.0 && ratio < 4.5) {
        expect(meetsWCAG_AA(fg, bg, true)).toBe(true);
        expect(meetsWCAG_AA(fg, bg, false)).toBe(false);
      }
    });
  });

  describe("meetsWCAG_AAA", () => {
    it("should pass for very high contrast", () => {
      expect(meetsWCAG_AAA("#000000", "#ffffff")).toBe(true);
    });

    it("should fail for moderate contrast", () => {
      expect(meetsWCAG_AAA("#666666", "#ffffff")).toBe(false);
    });
  });
});
