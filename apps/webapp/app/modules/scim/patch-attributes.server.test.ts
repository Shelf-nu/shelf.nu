import { describe, expect, it } from "vitest";

import { ScimError } from "./errors.server";
import {
  isScimValueObject,
  normalizeScimPath,
  readScimAttribute,
  readScimStringValue,
} from "./patch-attributes.server";

describe("normalizeScimPath", () => {
  // RFC 7644 Section 3.10: attribute names are case-insensitive. Entra sends
  // title-cased ops and other IdPs send title-cased paths.
  it.each([
    ["active", "active"],
    ["Active", "active"],
    ["ACTIVE", "active"],
    ["userName", "username"],
    ["UserName", "username"],
    ["name.givenName", "name.givenname"],
    ["Name.GivenName", "name.givenname"],
    ["  active  ", "active"],
  ])("reads %j as %j", (input, expected) => {
    expect(normalizeScimPath(input)).toBe(expected);
  });

  it("reports no path for a path-less operation", () => {
    expect(normalizeScimPath(undefined)).toBeUndefined();
    // An empty or whitespace path is not a path; it must take the path-less
    // branch rather than matching nothing and being dropped.
    expect(normalizeScimPath("")).toBeUndefined();
    expect(normalizeScimPath("   ")).toBeUndefined();
  });
});

describe("readScimAttribute", () => {
  it("finds a key whatever its case", () => {
    const value = { Active: false };

    expect(readScimAttribute(value, "active")).toEqual({
      present: true,
      value: false,
    });
  });

  it("finds a dotted key whatever its case", () => {
    const value = { "Name.GivenName": "Jane" };

    expect(readScimAttribute(value, "name.givenName")).toEqual({
      present: true,
      value: "Jane",
    });
  });

  it("separates present-and-null from absent", () => {
    // Present and null means "clear this attribute"; absent means "leave it".
    // Collapsing the two would clear fields the IdP never mentioned.
    expect(readScimAttribute({ givenName: null }, "givenName")).toEqual({
      present: true,
      value: null,
    });
    expect(readScimAttribute({}, "givenName")).toEqual({
      present: false,
      value: undefined,
    });
  });

  it("does not match a different attribute", () => {
    expect(readScimAttribute({ userName: "a" }, "name")).toEqual({
      present: false,
      value: undefined,
    });
  });
});

describe("isScimValueObject", () => {
  it("accepts a plain object", () => {
    expect(isScimValueObject({ active: true })).toBe(true);
  });

  it("rejects the shapes that are not attribute maps", () => {
    // An array passes a bare `typeof === "object"` check, which is how a
    // multi-valued payload would be read as an attribute map.
    expect(isScimValueObject([{ active: true }])).toBe(false);
    expect(isScimValueObject(null)).toBe(false);
    expect(isScimValueObject("active")).toBe(false);
    expect(isScimValueObject(undefined)).toBe(false);
  });
});

describe("readScimStringValue", () => {
  it("passes a string through untouched", () => {
    expect(readScimStringValue("Jane", "name.givenName")).toBe("Jane");
  });

  it("reads absent and null as clearing the attribute", () => {
    expect(readScimStringValue(undefined, "name.givenName")).toBe("");
    expect(readScimStringValue(null, "name.givenName")).toBe("");
  });

  // The corruption: String({}) is "[object Object]", which stores cleanly,
  // answers 200, and reads back as the person's name.
  it.each([
    [{ first: "John" }, "an object"],
    [["John"], "an array"],
    [42, "a number"],
    [true, "a boolean"],
  ])("refuses %j rather than coercing it", (value, described) => {
    expect(() => readScimStringValue(value, "name.givenName")).toThrow(
      ScimError
    );

    try {
      readScimStringValue(value, "name.givenName");
    } catch (error) {
      const scimError = error as ScimError;
      expect(scimError.status).toBe(400);
      expect(scimError.scimType).toBe("invalidValue");
      // The attribute and the type it got are what tell whoever configured
      // the mapping what to change.
      expect(scimError.message).toContain("name.givenName");
      expect(scimError.message).toContain(described);
    }
  });

  it("never echoes the rejected value back", () => {
    // The value is attacker-influenced and ends up in the IdP's logs.
    try {
      readScimStringValue({ secret: "s3cret-token" }, "userName");
    } catch (error) {
      expect((error as ScimError).message).not.toContain("s3cret-token");
    }
  });
});
