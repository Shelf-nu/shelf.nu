import { describe, expect, it } from "vitest";

import { resolveShowShelfBranding } from "~/utils/branding";

describe("resolveShowShelfBranding", () => {
  it("returns the override when it is explicitly provided", () => {
    expect(resolveShowShelfBranding(true, false)).toBe(true);
    expect(resolveShowShelfBranding(false, true)).toBe(false);
  });

  it("falls back to the organization default when override is undefined", () => {
    expect(resolveShowShelfBranding(undefined, false)).toBe(false);
    expect(resolveShowShelfBranding(undefined, true)).toBe(true);
  });

  it("defaults to true when both override and organization default are undefined", () => {
    expect(resolveShowShelfBranding(undefined, undefined)).toBe(true);
  });
});
