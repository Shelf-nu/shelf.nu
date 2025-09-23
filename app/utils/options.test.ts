import { describe, expect, it } from "vitest";

import { isOption, resolveSelectState } from "./options";

describe("options utilities", () => {
  const OPTIONS = ["A", "B", "C"] as const;

  it("detects when a value is part of the options", () => {
    expect(isOption(OPTIONS, "B")).toBe(true);
    expect(isOption(OPTIONS, "D")).toBe(false);
    expect(isOption(OPTIONS, 42)).toBe(false);
  });

  it("returns empty selection for falsy values", () => {
    expect(resolveSelectState(OPTIONS, null)).toEqual({
      selection: "",
      customValue: "",
    });
    expect(resolveSelectState(OPTIONS, "   ")).toEqual({
      selection: "",
      customValue: "",
    });
  });

  it("returns the preset selection when it matches", () => {
    expect(resolveSelectState(OPTIONS, "B")).toEqual({
      selection: "B",
      customValue: "",
    });
  });

  it("falls back to \"other\" with the trimmed custom value", () => {
    expect(resolveSelectState(OPTIONS, " custom ")).toEqual({
      selection: "other",
      customValue: "custom",
    });
  });
});
