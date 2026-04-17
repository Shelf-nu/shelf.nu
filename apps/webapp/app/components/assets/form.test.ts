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
