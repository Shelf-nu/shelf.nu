/**
 * formatNameList - unit tests
 *
 * Pins the elision boundary: up to three names are spelled out, a fourth turns
 * into "and N more".
 *
 * @see {@link file://./format-name-list.ts}
 */

import { describe, expect, it } from "vitest";

import { formatNameList } from "./format-name-list";

describe("formatNameList", () => {
  it("returns an empty string for no names", () => {
    expect(formatNameList([])).toBe("");
  });

  it("spells out up to three names", () => {
    expect(formatNameList(["A", "B", "C"])).toBe("A, B, C");
  });

  it("names the first three and counts the rest", () => {
    expect(formatNameList(["A", "B", "C", "D"])).toBe("A, B, C and 1 more");
  });
});
