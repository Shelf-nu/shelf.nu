/**
 * What happens when an operator presses enter in the option builder.
 *
 * This is where option text gets normalised, because it is the only place that
 * touches an option BEFORE anything stores it. Normalising later, when a
 * definition is saved, would rewrite options that assets already point at by
 * their exact string.
 *
 * @see {@link file://./option-builder.tsx}
 */
import { describe, expect, it } from "vitest";

import { resolveOptionEntry } from "./option-builder";

describe("resolveOptionEntry", () => {
  it("adds a plain option", () => {
    expect(resolveOptionEntry("Large", [])).toEqual({
      status: "add",
      option: "Large",
    });
  });

  it("trims what it adds", () => {
    expect(resolveOptionEntry("  Large  ", [])).toEqual({
      status: "add",
      option: "Large",
    });
  });

  it("ignores a blank entry", () => {
    expect(resolveOptionEntry("   ", [])).toEqual({ status: "ignore" });
    expect(resolveOptionEntry("", [])).toEqual({ status: "ignore" });
  });

  it("rejects an exact duplicate", () => {
    expect(resolveOptionEntry("Large", ["Large"])).toEqual({
      status: "duplicate",
    });
  });

  it("rejects a duplicate that differs only by surrounding space", () => {
    // Comparing raw strings would let both through, and they render as two
    // dropdown rows an operator cannot tell apart.
    expect(resolveOptionEntry("Large", [" Large "])).toEqual({
      status: "duplicate",
    });
    expect(resolveOptionEntry(" Large ", ["Large"])).toEqual({
      status: "duplicate",
    });
  });

  it("treats options differing in inner text as distinct", () => {
    expect(resolveOptionEntry("Large box", ["Large"])).toEqual({
      status: "add",
      option: "Large box",
    });
  });
});
