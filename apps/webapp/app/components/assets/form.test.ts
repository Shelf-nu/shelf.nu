import { describe, expect, it } from "vitest";
import { NewAssetFormSchema } from "./form";

describe("NewAssetFormSchema", () => {
  const baseValidData = {
    title: "Test Asset",
    description: "A description",
    category: "cat-123",
  };

  it("parses a valid INDIVIDUAL asset (default type)", () => {
    const result = NewAssetFormSchema.safeParse(baseValidData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("INDIVIDUAL");
    }
  });

  it("parses a valid QUANTITY_TRACKED asset with all quantity fields", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "100",
      minQuantity: "10",
      consumptionType: "ONE_WAY",
      unitOfMeasure: "pcs",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("QUANTITY_TRACKED");
      expect(result.data.quantity).toBe(100);
      expect(result.data.minQuantity).toBe(10);
      expect(result.data.consumptionType).toBe("ONE_WAY");
      expect(result.data.unitOfMeasure).toBe("pcs");
    }
  });

  it("coerces string quantity to number", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "50",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(50);
    }
  });

  it("rejects quantity <= 0", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "0",
    });

    expect(result.success).toBe(false);
  });

  /**
   * `minQuantity = 0` is the out-of-stock threshold: alert when nothing is
   * left. `low-stock.server.ts` states that semantics explicitly and tests
   * `minQuantity != null`, never truthiness, and the CSV importer accepts any
   * non-negative whole number, so the form is the only place that can refuse
   * it, and refusing it makes a supported configuration unreachable from the UI.
   */
  it("accepts minQuantity of 0 as the out-of-stock threshold", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      minQuantity: "0",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minQuantity).toBe(0);
    }
  });

  it("still maps an empty minQuantity to null rather than 0", () => {
    // Empty and zero are different answers: no threshold vs. a threshold of
    // zero. The transform has to keep them apart.
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      minQuantity: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minQuantity).toBeNull();
    }
  });

  it("rejects negative minQuantity", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      minQuantity: "-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid AssetType enum value", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "INVALID_TYPE",
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid ConsumptionType enum value", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      consumptionType: "INVALID",
    });

    expect(result.success).toBe(false);
  });

  it("allows QUANTITY_TRACKED without optional fields", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "50",
      // consumptionType, minQuantity, unitOfMeasure all optional at schema level
      // (server-side validation enforces consumptionType for QUANTITY_TRACKED)
    });

    expect(result.success).toBe(true);
  });

  it("rejects unitOfMeasure containing Markdoc tag syntax", () => {
    const open = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      unitOfMeasure: '{% link to="/login" text="Click" /%}',
    });
    expect(open.success).toBe(false);

    const partialOpen = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      unitOfMeasure: "boxes {% ",
    });
    expect(partialOpen.success).toBe(false);

    const partialClose = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      unitOfMeasure: "boxes %}",
    });
    expect(partialClose.success).toBe(false);
  });

  it("accepts unitOfMeasure with stray `{` or `}` only (not the `{%` pair)", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "QUANTITY_TRACKED",
      quantity: "10",
      unitOfMeasure: "boxes { count }",
    });
    expect(result.success).toBe(true);
  });

  it("allows INDIVIDUAL type without quantity fields", () => {
    const result = NewAssetFormSchema.safeParse({
      ...baseValidData,
      type: "INDIVIDUAL",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBeUndefined();
      expect(result.data.consumptionType).toBeUndefined();
    }
  });
});
