/**
 * Reading integers out of a query string.
 *
 * The case that matters is the one the usual `parseInt(get(k) || "1", 10)`
 * misses: `||` guards a MISSING parameter, not an unreadable one, so a value
 * like `?page=abc` parses to `NaN` and travels on into a `skip`, a `take` or a
 * day count — surfacing as an empty page or a thrown query rather than as a
 * bad request.
 *
 * @see {@link file://./search-params-number.ts}
 */
import { describe, expect, it } from "vitest";

import { getIntParam } from "./search-params-number";

const params = (qs: string) => new URLSearchParams(qs);

describe("getIntParam", () => {
  it("reads an ordinary integer", () => {
    expect(getIntParam(params("page=3"), "page", 1)).toBe(3);
  });

  it("falls back when the parameter is absent", () => {
    expect(getIntParam(params(""), "page", 1)).toBe(1);
  });

  it("falls back when the value is present but unreadable", () => {
    // The whole point: `"abc" || "1"` is `"abc"`, so the usual guard never
    // fires and `NaN` escapes.
    expect(getIntParam(params("page=abc"), "page", 1)).toBe(1);
    expect(Number.isNaN(getIntParam(params("page=abc"), "page", 1))).toBe(
      false
    );
  });

  it("falls back on an empty value", () => {
    expect(getIntParam(params("page="), "page", 7)).toBe(7);
  });

  it("keeps a leading-numeric value, matching parseInt", () => {
    // `parseInt` reads as far as it can. Preserved deliberately: changing it
    // would alter behaviour for callers this is replacing.
    expect(getIntParam(params("page=12abc"), "page", 1)).toBe(12);
  });

  it("reads a negative value rather than silently discarding it", () => {
    expect(getIntParam(params("page=-5"), "page", 1)).toBe(-5);
  });

  it("clamps to a minimum when one is given", () => {
    // A page of 0 or below is meaningless as an offset, and the fallback is
    // the wrong answer for it — the caller asked for a floor, not a default.
    expect(getIntParam(params("page=-5"), "page", 1, { min: 1 })).toBe(1);
    expect(getIntParam(params("page=0"), "page", 1, { min: 1 })).toBe(1);
    expect(getIntParam(params("page=9"), "page", 1, { min: 1 })).toBe(9);
  });

  it("clamps the fallback too, so an absent parameter cannot dodge the floor", () => {
    expect(getIntParam(params(""), "page", 0, { min: 1 })).toBe(1);
  });
});
