import { describe, it, expect } from "vitest";
import { splitName } from "./helpers";

describe("splitName", () => {
  it("splits 'John Doe' into firstName and lastName", () => {
    expect(splitName("John Doe")).toEqual({
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("handles single name without space", () => {
    expect(splitName("John")).toEqual({
      firstName: "John",
      lastName: "",
    });
  });

  it("handles multiple spaces (compound last name)", () => {
    expect(splitName("John Van Der Berg")).toEqual({
      firstName: "John",
      lastName: "Van Der Berg",
    });
  });

  it("trims leading and trailing whitespace", () => {
    expect(splitName("  John Doe  ")).toEqual({
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("trims double spaces between names", () => {
    expect(splitName("John  Doe")).toEqual({
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("handles empty string", () => {
    expect(splitName("")).toEqual({
      firstName: "",
      lastName: "",
    });
  });

  it("handles whitespace-only string", () => {
    expect(splitName("   ")).toEqual({
      firstName: "",
      lastName: "",
    });
  });

  it("handles null", () => {
    expect(splitName(null)).toEqual({
      firstName: "",
      lastName: "",
    });
  });

  it("handles undefined", () => {
    expect(splitName(undefined)).toEqual({
      firstName: "",
      lastName: "",
    });
  });
});
