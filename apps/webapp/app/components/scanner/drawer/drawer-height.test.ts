/**
 * Tests for {@link resolveDrawerHeight}.
 *
 * The scanner drawer is `position: fixed` and sized in pixels, so a height
 * larger than the viewport puts its top edge — and therefore its drag handle —
 * off-screen, with the rest of its chrome pushed past the bottom edge. Nothing
 * can scroll it back into view. The clamp is the only thing standing between a
 * tall header and an unreachable drawer, which is what these cases pin.
 *
 * @see {@link file://./drawer-height.ts}
 * @see {@link file://./base-drawer.tsx}
 */

import { describe, expect, it } from "vitest";

import {
  DRAWER_TOP_GAP,
  MIN_DRAWER_HEIGHT,
  resolveDrawerHeight,
  SCANNER_VIEWFINDER_GAP,
} from "./drawer-height";

/** A typical laptop viewport, used wherever the exact number is irrelevant. */
const VH = 830;

/** Baseline args; each test overrides only the field it is about. */
const baseArgs = {
  expanded: false,
  isScannerMode: false,
  viewportHeight: VH,
  chromeHeight: null,
  footerHeight: 0,
  hasBody: true,
  collapsedHeight: 170,
};

describe("resolveDrawerHeight", () => {
  describe("collapsed", () => {
    it("uses the measured chrome height when the drawer has custom header content", () => {
      expect(resolveDrawerHeight({ ...baseArgs, chromeHeight: 260 })).toBe(260);
    });

    it("uses the caller's collapsed height when there is a body but no custom chrome", () => {
      expect(resolveDrawerHeight({ ...baseArgs, collapsedHeight: 193 })).toBe(
        193
      );
    });

    it("falls back to the minimum height when there is nothing to show", () => {
      expect(resolveDrawerHeight({ ...baseArgs, hasBody: false })).toBe(
        MIN_DRAWER_HEIGHT
      );
    });

    it("pays for a pinned footer with height rather than list preview", () => {
      // `collapsedHeight` is chosen to show the first item. Rendering the
      // footer inside that budget would trade the preview for the button;
      // adding to it keeps both.
      expect(
        resolveDrawerHeight({
          ...baseArgs,
          collapsedHeight: 170,
          footerHeight: 64,
        })
      ).toBe(234);
    });

    it("does not double-count the footer when the chrome is measured whole", () => {
      // A measured `chromeHeight` already contains the footer.
      expect(
        resolveDrawerHeight({
          ...baseArgs,
          chromeHeight: 324,
          footerHeight: 64,
        })
      ).toBe(324);
    });

    it("never grows past the viewport, however tall the measured chrome is", () => {
      // 40 reserved models render ~1100px of progress strips — taller than the
      // whole viewport. Without the clamp the drawer's handle, title bar and
      // submit button all land outside the screen with no way to scroll to them.
      const height = resolveDrawerHeight({
        ...baseArgs,
        chromeHeight: 1195,
      });

      expect(height).toBe(VH - DRAWER_TOP_GAP);
      expect(height).toBeLessThan(VH);
    });
  });

  describe("expanded", () => {
    it("leaves room for the camera viewfinder in scanner mode", () => {
      expect(
        resolveDrawerHeight({
          ...baseArgs,
          expanded: true,
          isScannerMode: true,
        })
      ).toBe(VH - SCANNER_VIEWFINDER_GAP);
    });

    it("fills the viewport below the page chrome outside scanner mode", () => {
      expect(resolveDrawerHeight({ ...baseArgs, expanded: true })).toBe(
        VH - DRAWER_TOP_GAP
      );
    });

    it("grows past the viewfinder gap rather than push the pinned footer off", () => {
      // Drawers with no custom header (update-location, assign-custody,
      // release-custody) have an empty header wrapper, so nothing there can
      // give up height. Their footer is `shrink-0` by design — the action must
      // never sit behind its own scrollbar — so the drawer itself has to be
      // tall enough to hold it. The camera yields, not the submit button.
      const height = resolveDrawerHeight({
        ...baseArgs,
        expanded: true,
        isScannerMode: true,
        footerHeight: 460,
      });

      expect(height).toBe(MIN_DRAWER_HEIGHT + 460);
      expect(height).toBeGreaterThan(VH - SCANNER_VIEWFINDER_GAP);
    });

    it("still clamps when even the unshrinkable chrome outgrows the screen", () => {
      // The ceiling wins regardless: a drawer taller than its viewport puts
      // its own drag handle off the top, which is worse than a clipped footer.
      const height = resolveDrawerHeight({
        ...baseArgs,
        expanded: true,
        isScannerMode: true,
        footerHeight: 900,
      });

      expect(height).toBe(VH - DRAWER_TOP_GAP);
    });

    it("stays on-screen on a viewport shorter than the scanner gap", () => {
      const height = resolveDrawerHeight({
        ...baseArgs,
        expanded: true,
        isScannerMode: true,
        viewportHeight: 320,
      });

      expect(height).toBe(MIN_DRAWER_HEIGHT);
      expect(height).toBeGreaterThan(0);
    });
  });

  it("yields the floor to a viewport smaller than the floor itself", () => {
    // The floor exists so a drawer is always tall enough to grab and reopen.
    // On a viewport shorter than the floor, honouring it would push the drawer
    // — and the drag handle that is its first child — off the top of the
    // screen, which is the one thing the floor cannot be allowed to cause.
    const height = resolveDrawerHeight({
      ...baseArgs,
      viewportHeight: 120,
      chromeHeight: 400,
    });

    expect(height).toBe(120);
    expect(height).toBeLessThanOrEqual(120);
  });

  it("skips the clamp before the viewport has been measured", () => {
    // `useViewportHeight` starts at 0 until the browser reports a real height.
    // Clamping against 0 would collapse the drawer to nothing on first paint.
    expect(
      resolveDrawerHeight({
        ...baseArgs,
        viewportHeight: 0,
        chromeHeight: 260,
      })
    ).toBe(260);
  });
});
