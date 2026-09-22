/**
 * Tests for {@link resolveFillHeight}.
 *
 * The arithmetic is trivial; what it encodes is not. A full-bleed pane has to
 * end flush with the bottom of its scroll container whatever sits above it, and
 * the arrangements differ: nothing above on a wide viewport, a top bar below
 * `md`, an account banner on top of either. These cases pin that the height
 * follows the measured offset rather than any one arrangement's constant.
 *
 * @see {@link file://./use-fill-viewport-height.ts}
 */
import { describe, expect, it } from "vitest";

import { resolveFillHeight } from "./use-fill-viewport-height";

describe("resolveFillHeight", () => {
  it("fills the whole container when nothing sits above the pane", () => {
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 0 })
    ).toBe(982);
  });

  it("gives back the space taken by chrome above the pane", () => {
    // A mobile top bar of 65px leaves the rest of the screen to the pane.
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 65 })
    ).toBe(917);
  });

  it("accounts for stacked chrome, not just one bar", () => {
    // Top bar plus an account banner — the case a single constant cannot cover.
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 65 + 48 })
    ).toBe(869);
  });

  it("holds the floor when the offset would leave less than the minimum", () => {
    expect(
      resolveFillHeight({
        containerHeight: 500,
        elementOffsetTop: 400,
        minHeight: 400,
      })
    ).toBe(400);
  });

  it("never returns a negative height", () => {
    expect(
      resolveFillHeight({ containerHeight: 300, elementOffsetTop: 900 })
    ).toBe(0);
  });
});
