/**
 * The blank-versus-zero decision for numeric form fields.
 *
 * Every case here turns on one fact: `Number("")`, `Number("   ")` and
 * `Number("0")` are all `0`. These builders exist to separate those before the
 * coercion happens, so the cases that matter most are the ones that look alike
 * afterwards.
 *
 * @see {@link file://./zod-numeric.ts}
 */
import { describe, expect, it } from "vitest";

import {
  optionalNumberFromString,
  requiredNumberFromString,
} from "./zod-numeric";

describe("optionalNumberFromString", () => {
  const nullable = optionalNumberFromString({ blank: null });

  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["a tab", "\t"],
    ["undefined", undefined],
  ])("treats %s as absent", (_label, input) => {
    const result = nullable.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("keeps a deliberate zero as zero", () => {
    const result = nullable.safeParse("0");

    expect(result.success).toBe(true);
    if (result.success) {
      // The case the whole module exists for: indistinguishable from blank once
      // coerced, so it has to survive the decision made before coercion.
      expect(result.data).toBe(0);
    }
  });

  it("reads a padded number", () => {
    // Trimming decides blankness; `Number` handles the padding itself.
    expect(nullable.parse(" 5 ")).toBe(5);
  });

  it("reads a negative and a decimal", () => {
    expect(nullable.parse("-3")).toBe(-3);
    expect(nullable.parse("12.5")).toBe(12.5);
  });

  it("yields undefined instead of null when the caller asks for it", () => {
    const optional = optionalNumberFromString({ blank: undefined });

    expect(optional.parse("")).toBeUndefined();
    expect(optional.parse("0")).toBe(0);
  });

  it("rejects text that is not a number, rather than yielding NaN", () => {
    // A call site with no bound piped after it would otherwise store NaN. Not
    // every site has one: `valuation` is a bare builder call.
    expect(nullable.safeParse("abc").success).toBe(false);
  });

  it("names the field when rejecting unreadable text", () => {
    const named = optionalNumberFromString({
      blank: null,
      fieldName: "Valuation",
    });
    const result = named.safeParse("abc");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Valuation must be a number");
    }
  });

  it("rejects a value that is not text or a number at all", () => {
    expect(nullable.safeParse({}).success).toBe(false);
    expect(nullable.safeParse(null).success).toBe(false);
  });
});

describe("requiredNumberFromString", () => {
  const required = requiredNumberFromString({ fieldName: "Shelf count" });

  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["undefined", undefined],
  ])("rejects %s", (_label, input) => {
    expect(required.safeParse(input).success).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["undefined", undefined],
  ])("names the field when rejecting %s", (_label, input) => {
    const result = required.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      // A type error ("Expected string, received undefined") would be true and
      // useless: the operator has to be told which field to fill in.
      expect(result.error.issues[0].message).toBe("Shelf count is required");
    }
  });

  it("falls back to a generic message when the field is unnamed", () => {
    const unnamed = requiredNumberFromString();
    const result = unnamed.safeParse("");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("This field is required");
    }
  });

  it("accepts zero, because required means a value was given", () => {
    const result = required.safeParse("0");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(0);
    }
  });

  it("accepts a number that arrives already coerced", () => {
    expect(required.parse(42)).toBe(42);
    expect(required.parse(0)).toBe(0);
  });

  it("rejects a non-numeric value", () => {
    expect(required.safeParse("abc").success).toBe(false);
  });
});
