import { describe, it, expect } from "vitest";
import { splitName } from "./name-splitter";

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
});
