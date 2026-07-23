import { describe, expect, it } from "vitest";
import { parseScimFilter } from "~/modules/scim/filters.server";

describe("parseScimFilter", () => {
  describe("valid simple filters", () => {
    it("should parse userName eq filter", () => {
      const result = parseScimFilter('userName eq "user@example.com"');

      expect(result).toEqual({
        attribute: "username",
        operator: "eq",
        value: "user@example.com",
      });
    });

    it("should parse externalId eq filter", () => {
      const result = parseScimFilter(
        'externalId eq "some-entra-object-id-123"'
      );

      expect(result).toEqual({
        attribute: "externalid",
        operator: "eq",
        value: "some-entra-object-id-123",
      });
    });

    it("should lowercase attribute and operator", () => {
      const result = parseScimFilter('UserName EQ "test@example.com"');

      expect(result).toEqual({
        attribute: "username",
        operator: "eq",
        value: "test@example.com",
      });
    });

    it("should preserve original case of the value", () => {
      const result = parseScimFilter('userName eq "Mixed.Case@Example.COM"');

      expect(result).toEqual({
        attribute: "username",
        operator: "eq",
        value: "Mixed.Case@Example.COM",
      });
    });
  });

  describe("all supported operators", () => {
    const operators = ["eq", "ne", "co", "sw", "ew", "gt", "lt", "ge", "le"];

    operators.forEach((op) => {
      it(`should parse "${op}" operator`, () => {
        const result = parseScimFilter(`userName ${op} "test"`);

        expect(result).toEqual({
          attribute: "username",
          operator: op,
          value: "test",
        });
      });
    });
  });

  describe("dotted attribute names", () => {
    it("should parse name.familyName attribute", () => {
      const result = parseScimFilter('name.familyName eq "Smith"');

      expect(result).toEqual({
        attribute: "name.familyname",
        operator: "eq",
        value: "Smith",
      });
    });
  });

  describe("invalid filters", () => {
    it("should return null for empty string", () => {
      expect(parseScimFilter("")).toBeNull();
    });

    it("should return null for compound filters (and/or)", () => {
      expect(
        parseScimFilter('userName eq "a@b.com" and externalId eq "123"')
      ).toBeNull();
    });

    it("should return null for missing quotes around value", () => {
      expect(parseScimFilter("userName eq user@example.com")).toBeNull();
    });

    it("should return null for unsupported operator", () => {
      expect(parseScimFilter('userName pr "test"')).toBeNull();
    });

    it("should return null for malformed filter string", () => {
      expect(parseScimFilter("not a filter")).toBeNull();
    });
  });
});
