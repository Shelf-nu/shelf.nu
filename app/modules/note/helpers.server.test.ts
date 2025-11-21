import { Decimal } from "@prisma/client/runtime/library";
import { describe, expect, it } from "vitest";

import {
  buildCategoryChangeNote,
  buildDescriptionChangeNote,
  buildNameChangeNote,
  buildValuationChangeNote,
  normalizeText,
  toNullableNumber,
} from "./helpers.server";

const userLink = '{% user id="user-1" /%}';

describe("normalizeText", () => {
  it("returns null for null input", () => {
    expect(normalizeText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeText(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeText("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeText("   ")).toBeNull();
    expect(normalizeText("\t\n")).toBeNull();
  });

  it("returns trimmed string for valid text", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
    expect(normalizeText("test")).toBe("test");
  });

  it("returns null for non-string values", () => {
    expect(normalizeText(123 as any)).toBeNull();
    expect(normalizeText({} as any)).toBeNull();
  });
});

describe("buildNameChangeNote", () => {
  it("returns null when names are identical", () => {
    expect(
      buildNameChangeNote({
        userLink,
        previous: "Test Asset",
        next: "Test Asset",
      })
    ).toBeNull();
  });

  it("returns null when previous name is missing", () => {
    expect(
      buildNameChangeNote({ userLink, previous: null, next: "New Name" })
    ).toBeNull();
  });

  it("returns null when next name is missing", () => {
    expect(
      buildNameChangeNote({ userLink, previous: "Old Name", next: null })
    ).toBeNull();
  });

  it("returns null when both names are empty strings", () => {
    expect(
      buildNameChangeNote({ userLink, previous: "", next: "" })
    ).toBeNull();
  });

  it("builds note for name change", () => {
    const result = buildNameChangeNote({
      userLink,
      previous: "Old Asset",
      next: "New Asset",
    });

    expect(result).toBe(
      `${userLink} updated the asset name from **Old Asset** to **New Asset**.`
    );
  });

  it("escapes markdown special characters in names", () => {
    const result = buildNameChangeNote({
      userLink,
      previous: "Asset*with*stars",
      next: "Asset_with_underscores",
    });

    expect(result).toContain("\\*");
    expect(result).toContain("\\_");
    expect(result).toBe(
      `${userLink} updated the asset name from **Asset\\*with\\*stars** to **Asset\\_with\\_underscores**.`
    );
  });

  it("escapes backticks and tildes", () => {
    const result = buildNameChangeNote({
      userLink,
      previous: "Asset`with`backticks",
      next: "Asset~with~tildes",
    });

    expect(result).toContain("\\`");
    expect(result).toContain("\\~");
  });

  it("handles names with whitespace trimming", () => {
    const result = buildNameChangeNote({
      userLink,
      previous: "  Old  ",
      next: "  New  ",
    });

    expect(result).toBe(
      `${userLink} updated the asset name from **Old** to **New**.`
    );
  });
});

describe("buildCategoryChangeNote", () => {
  it("returns null when categories are identical", () => {
    const category = { id: "1", name: "Electronics", color: "#FF0000" };
    expect(
      buildCategoryChangeNote({
        userLink,
        previous: category,
        next: category,
      })
    ).toBeNull();
  });

  it("builds note for setting first category", () => {
    const result = buildCategoryChangeNote({
      userLink,
      previous: null,
      next: { id: "1", name: "Electronics", color: "#FF0000" },
    });

    expect(result).toContain("set the asset category to");
    expect(result).toContain("category_badge");
  });

  it("builds note for removing category", () => {
    const result = buildCategoryChangeNote({
      userLink,
      previous: { id: "1", name: "Electronics", color: "#FF0000" },
      next: null,
    });

    expect(result).toBe(`${userLink} removed the asset category.`);
  });

  it("builds note for changing category", () => {
    const result = buildCategoryChangeNote({
      userLink,
      previous: { id: "1", name: "Electronics", color: "#FF0000" },
      next: { id: "2", name: "Furniture", color: "#00FF00" },
    });

    expect(result).toContain("changed the asset category from");
    expect(result).toContain("category_badge");
  });
});

describe("buildDescriptionChangeNote", () => {
  it("returns null when description did not change", () => {
    expect(
      buildDescriptionChangeNote({ userLink, previous: "Test", next: "Test" })
    ).toBeNull();
  });

  it("describes adding the first description", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: null,
      next: "New details",
    });

    expect(result).toBe(
      `${userLink} added an asset description {% description newText="New details" /%}.`
    );
  });

  it("describes removing an existing description", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: "Old details",
      next: "",
    });

    expect(result).toBe(
      `${userLink} removed the asset description {% description oldText="Old details" /%}.`
    );
  });

  it("renders updates between two descriptions", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: "Old description",
      next: "Updated description",
    });

    expect(result).toBe(
      `${userLink} updated the asset description {% description oldText="Old description" newText="Updated description" /%}.`
    );
  });

  it("treats whitespace-only as no description", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: "Old",
      next: "   ",
    });

    expect(result).toContain("removed the asset description");
  });
});

describe("toNullableNumber", () => {
  it("returns null for null input", () => {
    expect(toNullableNumber(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(toNullableNumber(undefined)).toBeNull();
  });

  it("converts regular numbers", () => {
    expect(toNullableNumber(42)).toBe(42);
    expect(toNullableNumber(0)).toBe(0);
    expect(toNullableNumber(-10.5)).toBe(-10.5);
  });

  it("converts numeric strings", () => {
    expect(toNullableNumber("42")).toBe(42);
    expect(toNullableNumber("3.14")).toBe(3.14);
  });

  it("returns null for invalid values", () => {
    expect(toNullableNumber("not a number")).toBeNull();
    expect(toNullableNumber(NaN)).toBeNull();
    expect(toNullableNumber(Infinity)).toBeNull();
    expect(toNullableNumber(-Infinity)).toBeNull();
  });

  it("converts Prisma Decimal to number", () => {
    const decimal = new Decimal("123.45");
    expect(toNullableNumber(decimal)).toBe(123.45);
  });

  it("handles Prisma Decimal edge cases", () => {
    const zero = new Decimal(0);
    expect(toNullableNumber(zero)).toBe(0);

    const negative = new Decimal("-99.99");
    expect(toNullableNumber(negative)).toBe(-99.99);
  });

  it("returns null for objects without toNumber method", () => {
    expect(toNullableNumber({})).toBeNull();
    expect(toNullableNumber({ value: 42 })).toBeNull();
  });
});

describe("buildValuationChangeNote", () => {
  const currency = "USD" as any;
  const locale = "en-US";

  it("returns null when valuations are identical", () => {
    expect(
      buildValuationChangeNote({
        userLink,
        previous: 100,
        next: 100,
        currency,
        locale,
      })
    ).toBeNull();
  });

  it("builds note for setting first valuation", () => {
    const result = buildValuationChangeNote({
      userLink,
      previous: null,
      next: 500,
      currency,
      locale,
    });

    expect(result).toContain("set the asset value to");
    expect(result).toContain("$");
  });

  it("builds note for removing valuation", () => {
    const result = buildValuationChangeNote({
      userLink,
      previous: 500,
      next: null,
      currency,
      locale,
    });

    expect(result).toBe(`${userLink} removed the asset value.`);
  });

  it("builds note for changing valuation", () => {
    const result = buildValuationChangeNote({
      userLink,
      previous: 100,
      next: 200,
      currency,
      locale,
    });

    expect(result).toContain("changed the asset value from");
    expect(result).toContain("$100");
    expect(result).toContain("$200");
  });

  it("handles Prisma Decimal values", () => {
    const result = buildValuationChangeNote({
      userLink,
      previous: new Decimal("99.99"),
      next: new Decimal("199.99"),
      currency,
      locale,
    });

    expect(result).toContain("changed the asset value from");
  });

  it("returns null when both values are zero", () => {
    expect(
      buildValuationChangeNote({
        userLink,
        previous: 0,
        next: 0,
        currency,
        locale,
      })
    ).toBeNull();
  });

  it("handles change from zero to positive value", () => {
    const result = buildValuationChangeNote({
      userLink,
      previous: 0,
      next: 100,
      currency,
      locale,
    });

    expect(result).toContain("changed the asset value from");
  });
});
