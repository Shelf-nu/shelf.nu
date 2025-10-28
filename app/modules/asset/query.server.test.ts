import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  parseFilters,
  getQueryFieldType,
  parseSortingOptions,
} from "./query.server";

// @vitest-environment node

describe("asset query.server", () => {
  describe("parseFilters", () => {
    it("parses simple string filters", () => {
      const filters = parseFilters({
        title: "Laptop",
        description: "Dell computer",
      });

      expect(filters).toHaveLength(2);
      expect(filters[0]).toEqual({
        name: "title",
        operator: "contains",
        value: "Laptop",
      });
      expect(filters[1]).toEqual({
        name: "description",
        operator: "contains",
        value: "Dell computer",
      });
    });

    it("parses status filters", () => {
      const filters = parseFilters({
        status: "AVAILABLE",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "status",
        operator: "is",
        value: "AVAILABLE",
      });
    });

    it("parses multiple status values as array", () => {
      const filters = parseFilters({
        status: ["AVAILABLE", "CHECKED_OUT"],
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "status",
        operator: "matchesAny",
        value: ["AVAILABLE", "CHECKED_OUT"],
      });
    });

    it("handles categoryId filter", () => {
      const filters = parseFilters({
        categoryId: "cat-123",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "categoryId",
        operator: "is",
        value: "cat-123",
      });
    });

    it("handles multiple categoryId values", () => {
      const filters = parseFilters({
        categoryId: ["cat-123", "cat-456"],
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "categoryId",
        operator: "matchesAny",
        value: ["cat-123", "cat-456"],
      });
    });

    it("handles locationId filter", () => {
      const filters = parseFilters({
        locationId: "loc-789",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "locationId",
        operator: "is",
        value: "loc-789",
      });
    });

    it("handles multiple locationId values", () => {
      const filters = parseFilters({
        locationId: ["loc-123", "loc-456"],
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "locationId",
        operator: "matchesAny",
        value: ["loc-123", "loc-456"],
      });
    });

    it("handles tag filter", () => {
      const filters = parseFilters({
        tag: "electronics",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "tags",
        operator: "hasEvery",
        value: ["electronics"],
      });
    });

    it("handles multiple tag values", () => {
      const filters = parseFilters({
        tag: ["electronics", "borrowed"],
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "tags",
        operator: "hasEvery",
        value: ["electronics", "borrowed"],
      });
    });

    it("ignores empty string values", () => {
      const filters = parseFilters({
        title: "",
        description: "Valid",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0].name).toBe("description");
    });

    it("ignores null values", () => {
      const filters = parseFilters({
        title: null,
        description: "Valid",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0].name).toBe("description");
    });

    it("ignores undefined values", () => {
      const filters = parseFilters({
        title: undefined,
        description: "Valid",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0].name).toBe("description");
    });

    it("handles empty arrays", () => {
      const filters = parseFilters({
        categoryId: [],
      });

      expect(filters).toHaveLength(0);
    });

    it("parses complex filter combinations", () => {
      const filters = parseFilters({
        title: "Laptop",
        status: ["AVAILABLE", "CHECKED_OUT"],
        categoryId: "cat-123",
        locationId: ["loc-1", "loc-2"],
        tag: ["electronics", "borrowed"],
      });

      expect(filters).toHaveLength(5);
      expect(filters.map((f) => f.name)).toEqual([
        "title",
        "status",
        "categoryId",
        "locationId",
        "tags",
      ]);
    });

    it("handles custodianUserId filter", () => {
      const filters = parseFilters({
        custodianUserId: "user-123",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "custody",
        operator: "is",
        value: "user-123",
      });
    });

    it("handles multiple custodianUserId values", () => {
      const filters = parseFilters({
        custodianUserId: ["user-123", "user-456"],
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "custody",
        operator: "matchesAny",
        value: ["user-123", "user-456"],
      });
    });

    it("handles teamMemberId filter", () => {
      const filters = parseFilters({
        teamMemberId: "member-789",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "custody",
        operator: "is",
        value: "member-789",
      });
    });

    it("handles advanced mode filters with operators", () => {
      const filters = parseFilters({
        "title.contains": "Laptop",
        "status.is": "AVAILABLE",
        "createdAt.gte": "2024-01-01",
      });

      expect(filters).toHaveLength(3);
      expect(filters[0]).toEqual({
        name: "title",
        operator: "contains",
        value: "Laptop",
      });
      expect(filters[1]).toEqual({
        name: "status",
        operator: "is",
        value: "AVAILABLE",
      });
      expect(filters[2]).toEqual({
        name: "createdAt",
        operator: "gte",
        value: "2024-01-01",
      });
    });

    it("handles custom field filters", () => {
      const filters = parseFilters({
        "cf-field-123": "value",
      });

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        name: "cf-field-123",
        operator: "contains",
        value: "value",
      });
    });

    it("handles custom field filters with operators", () => {
      const filters = parseFilters({
        "cf-field-123.is": "exact-value",
        "cf-field-456.contains": "partial",
      });

      expect(filters).toHaveLength(2);
      expect(filters[0]).toEqual({
        name: "cf-field-123",
        operator: "is",
        value: "exact-value",
      });
      expect(filters[1]).toEqual({
        name: "cf-field-456",
        operator: "contains",
        value: "partial",
      });
    });

    it("trims whitespace from string values", () => {
      const filters = parseFilters({
        title: "  Laptop  ",
        description: "  Dell computer  ",
      });

      expect(filters[0].value).toBe("Laptop");
      expect(filters[1].value).toBe("Dell computer");
    });

    it("handles special characters in values", () => {
      const filters = parseFilters({
        title: "Laptop & Desktop",
        description: "Price: $500",
      });

      expect(filters[0].value).toBe("Laptop & Desktop");
      expect(filters[1].value).toBe("Price: $500");
    });

    it("returns empty array for empty input", () => {
      const filters = parseFilters({});
      expect(filters).toEqual([]);
    });

    it("handles numeric string values", () => {
      const filters = parseFilters({
        title: "123",
        description: "456.78",
      });

      expect(filters[0].value).toBe("123");
      expect(filters[1].value).toBe("456.78");
    });

    it("handles boolean-like string values", () => {
      const filters = parseFilters({
        title: "true",
        description: "false",
      });

      expect(filters[0].value).toBe("true");
      expect(filters[1].value).toBe("false");
    });
  });

  describe("getQueryFieldType", () => {
    it("identifies string fields", () => {
      expect(getQueryFieldType("title")).toBe("string");
      expect(getQueryFieldType("description")).toBe("string");
      expect(getQueryFieldType("mainImage")).toBe("string");
      expect(getQueryFieldType("mainImageExpiration")).toBe("string");
      expect(getQueryFieldType("model")).toBe("string");
      expect(getQueryFieldType("serialNumber")).toBe("string");
    });

    it("identifies date fields", () => {
      expect(getQueryFieldType("createdAt")).toBe("date");
      expect(getQueryFieldType("updatedAt")).toBe("date");
      expect(getQueryFieldType("availableToBook")).toBe("date");
    });

    it("identifies enum fields", () => {
      expect(getQueryFieldType("status")).toBe("enum");
      expect(getQueryFieldType("availability")).toBe("enum");
    });

    it("identifies relation fields", () => {
      expect(getQueryFieldType("categoryId")).toBe("relation");
      expect(getQueryFieldType("locationId")).toBe("relation");
      expect(getQueryFieldType("custody")).toBe("relation");
      expect(getQueryFieldType("tags")).toBe("relation");
    });

    it("identifies custom field with cf- prefix", () => {
      expect(getQueryFieldType("cf-field-123")).toBe("customField");
      expect(getQueryFieldType("cf-abc-xyz")).toBe("customField");
    });

    it("defaults to string for unknown fields", () => {
      expect(getQueryFieldType("unknownField")).toBe("string");
      expect(getQueryFieldType("randomProperty")).toBe("string");
    });

    it("handles empty string", () => {
      expect(getQueryFieldType("")).toBe("string");
    });

    it("is case-sensitive", () => {
      expect(getQueryFieldType("Title")).toBe("string");
      expect(getQueryFieldType("STATUS")).toBe("string");
      expect(getQueryFieldType("CreatedAt")).toBe("string");
    });
  });

  describe("parseSortingOptions", () => {
    it("parses single sort option", () => {
      const result = parseSortingOptions(["title:asc"]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "asc" }]);
      expect(result.customFields).toEqual([]);
    });

    it("parses multiple sort options", () => {
      const result = parseSortingOptions(["title:asc", "createdAt:desc"]);

      expect(result.sortBy).toEqual([
        { name: "title", direction: "asc" },
        { name: "createdAt", direction: "desc" },
      ]);
    });

    it("defaults to ascending when direction not specified", () => {
      const result = parseSortingOptions(["title"]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "asc" }]);
    });

    it("handles desc direction", () => {
      const result = parseSortingOptions(["title:desc"]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "desc" }]);
    });

    it("identifies custom field sorts", () => {
      const result = parseSortingOptions(["cf-field-123:asc"]);

      expect(result.customFields).toEqual([
        { id: "cf-field-123", direction: "asc" },
      ]);
      expect(result.sortBy).toEqual([]);
    });

    it("separates regular and custom field sorts", () => {
      const result = parseSortingOptions([
        "title:asc",
        "cf-field-123:desc",
        "createdAt:asc",
        "cf-field-456:asc",
      ]);

      expect(result.sortBy).toEqual([
        { name: "title", direction: "asc" },
        { name: "createdAt", direction: "asc" },
      ]);
      expect(result.customFields).toEqual([
        { id: "cf-field-123", direction: "desc" },
        { id: "cf-field-456", direction: "asc" },
      ]);
    });

    it("handles empty array", () => {
      const result = parseSortingOptions([]);

      expect(result.sortBy).toEqual([]);
      expect(result.customFields).toEqual([]);
    });

    it("handles malformed sort strings gracefully", () => {
      const result = parseSortingOptions(["title:asc:extra"]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "asc" }]);
    });

    it("ignores invalid directions", () => {
      const result = parseSortingOptions(["title:invalid"]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "asc" }]);
    });

    it("handles mixed case directions", () => {
      const result = parseSortingOptions([
        "title:ASC",
        "description:DESC",
        "model:Asc",
      ]);

      expect(result.sortBy).toEqual([
        { name: "title", direction: "asc" },
        { name: "description", direction: "desc" },
        { name: "model", direction: "asc" },
      ]);
    });

    it("preserves sort order", () => {
      const result = parseSortingOptions([
        "createdAt:desc",
        "title:asc",
        "status:asc",
      ]);

      expect(result.sortBy).toEqual([
        { name: "createdAt", direction: "desc" },
        { name: "title", direction: "asc" },
        { name: "status", direction: "asc" },
      ]);
    });

    it("handles empty strings in array", () => {
      const result = parseSortingOptions(["", "title:asc", ""]);

      expect(result.sortBy).toEqual([{ name: "title", direction: "asc" }]);
    });

    it("handles sort by category field", () => {
      const result = parseSortingOptions(["category:asc"]);

      expect(result.sortBy).toEqual([{ name: "category", direction: "asc" }]);
    });

    it("handles sort by location field", () => {
      const result = parseSortingOptions(["location:desc"]);

      expect(result.sortBy).toEqual([{ name: "location", direction: "desc" }]);
    });

    it("handles sort by custody field", () => {
      const result = parseSortingOptions(["custody:asc"]);

      expect(result.sortBy).toEqual([{ name: "custody", direction: "asc" }]);
    });

    it("handles valuation field", () => {
      const result = parseSortingOptions(["valuation:desc"]);

      expect(result.sortBy).toEqual([{ name: "valuation", direction: "desc" }]);
    });

    it("handles complex field names with hyphens", () => {
      const result = parseSortingOptions(["my-custom-field:asc"]);

      expect(result.sortBy).toEqual([
        { name: "my-custom-field", direction: "asc" },
      ]);
    });

    it("handles field names with underscores", () => {
      const result = parseSortingOptions(["field_name:desc"]);

      expect(result.sortBy).toEqual([
        { name: "field_name", direction: "desc" },
      ]);
    });

    it("extracts custom field ID correctly", () => {
      const result = parseSortingOptions([
        "cf-abc-123-xyz:asc",
        "cf-simple:desc",
      ]);

      expect(result.customFields).toEqual([
        { id: "abc-123-xyz", direction: "asc" },
        { id: "simple", direction: "desc" },
      ]);
    });

    it("handles very long field names", () => {
      const longName = "a".repeat(100);
      const result = parseSortingOptions([`${longName}:asc`]);

      expect(result.sortBy).toEqual([{ name: longName, direction: "asc" }]);
    });

    it("handles numeric field names", () => {
      const result = parseSortingOptions(["123:asc", "456:desc"]);

      expect(result.sortBy).toEqual([
        { name: "123", direction: "asc" },
        { name: "456", direction: "desc" },
      ]);
    });
  });
});