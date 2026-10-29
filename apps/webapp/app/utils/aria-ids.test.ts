/**
 * joinAriaIds - unit tests
 *
 * Covers the four combinations the kit "Add assets" confirm meets: no notice,
 * the move notice, the removal notice, or both.
 *
 * @see {@link file://./aria-ids.ts}
 */

import { describe, expect, it } from "vitest";

import { joinAriaIds } from "./aria-ids";

describe("joinAriaIds", () => {
  it("leaves the attribute off when no notice is present", () => {
    expect(joinAriaIds(null, false, undefined)).toBeUndefined();
  });

  it("points at the only notice present", () => {
    expect(joinAriaIds("move", null)).toBe("move");
    expect(joinAriaIds(false, "removal")).toBe("removal");
  });

  it("lists every present notice in order", () => {
    expect(joinAriaIds("move", "removal")).toBe("move removal");
  });
});
