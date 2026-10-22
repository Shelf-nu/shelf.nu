/**
 * Label form field unit tests.
 *
 * Pins the shared category and tag field rules: hex colour normalisation and
 * validation, and the name rule. The same schemas run in the browser
 * (react-zorm) and in the route actions, so these cases hold on both sides.
 *
 * @see {@link file://./label-form-fields.ts}
 */
import { describe, expect, it } from "vitest";
import {
  hexColorSchema,
  labelNameSchema,
  normalizeHexColor,
  optionalHexColorSchema,
} from "./label-form-fields";

describe("normalizeHexColor", () => {
  it.each([
    ["#4f46e5", "#4f46e5"],
    ["#4F46E5", "#4f46e5"],
    ["4f46e5", "#4f46e5"],
    ["  #4f46e5 ", "#4f46e5"],
    ["#fff", "#ffffff"],
    ["ABC", "#aabbcc"],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeHexColor(input)).toBe(expected);
  });
});

describe("labelNameSchema", () => {
  it("accepts short names", () => {
    expect(labelNameSchema.parse("IT")).toBe("IT");
    expect(labelNameSchema.parse("A")).toBe("A");
  });

  it("trims the name", () => {
    expect(labelNameSchema.parse("  AV  ")).toBe("AV");
  });

  it.each(["", "   "])("refuses a blank name %j", (input) => {
    const result = labelNameSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Name is required");
  });
});

describe("hexColorSchema", () => {
  it("stores typed shorthand in full form", () => {
    expect(hexColorSchema.parse("#FFF")).toBe("#ffffff");
  });

  it.each(["", "red", "#12345", "#gggggg"])(
    "refuses %j with a message",
    (input) => {
      const result = hexColorSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(
        "Enter a hex color, like #4f46e5"
      );
    }
  );
});

describe("optionalHexColorSchema", () => {
  it.each([undefined, "", "  "])("treats %j as no colour", (input) => {
    expect(optionalHexColorSchema.parse(input)).toBeNull();
  });

  it("normalises a typed colour", () => {
    expect(optionalHexColorSchema.parse("abc")).toBe("#aabbcc");
  });

  it("refuses a colour that is not hex", () => {
    expect(optionalHexColorSchema.safeParse("blue").success).toBe(false);
  });
});
