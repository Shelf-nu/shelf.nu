import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildCustomFieldValue } from "~/utils/custom-fields";
import { ShelfError } from "~/utils/error";

const baseCustomField: CustomField = {
  id: "cf_1",
  name: "Budget",
  helpText: null,
  required: false,
  active: true,
  type: "AMOUNT",
  options: [],
  organizationId: "org_1",
  userId: "user_1",
  createdAt: new Date("2023-01-01T00:00:00.000Z"),
  updatedAt: new Date("2023-01-01T00:00:00.000Z"),
  deletedAt: null,
};

describe("buildCustomFieldValue", () => {
  it("sanitizes currency formatted AMOUNT values", () => {
    const customField: CustomField = {
      ...baseCustomField,
      name: "Budget",
      type: "AMOUNT",
    } as CustomField;

    const result = buildCustomFieldValue({ raw: "$600.00 " }, customField);

    expect(result).toEqual({ raw: 600, valueText: "600.00" });
  });

  it("throws descriptive error for invalid numeric values", () => {
    const customField: CustomField = {
      ...baseCustomField,
      name: "Budget",
      type: "AMOUNT",
    } as CustomField;

    const buildInvalidValue = () =>
      buildCustomFieldValue({ raw: "invalid" }, customField);

    expect(buildInvalidValue).toThrowError(ShelfError);
    expect(buildInvalidValue).toThrowError(
      "Custom field 'Budget': Invalid value 'invalid'. Contains non-numeric characters. Expected format: Plain numbers with optional decimal separator (e.g., 600, 600.50, or 600,50). Currency symbols will be automatically removed."
    );
  });

  it("accepts plain numbers without separators", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "AMOUNT",
    } as CustomField;

    expect(buildCustomFieldValue({ raw: "600" }, customField)).toEqual({
      raw: 600,
      valueText: "600",
    });

    expect(buildCustomFieldValue({ raw: "1234" }, customField)).toEqual({
      raw: 1234,
      valueText: "1234",
    });
  });

  it("accepts numbers with single decimal separator (dot)", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "NUMBER",
    } as CustomField;

    expect(buildCustomFieldValue({ raw: "600.50" }, customField)).toEqual({
      raw: 600.5,
      valueText: "600.50",
    });
  });

  it("accepts numbers with single decimal separator (comma)", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "NUMBER",
    } as CustomField;

    expect(buildCustomFieldValue({ raw: "600,50" }, customField)).toEqual({
      raw: 600.5,
      valueText: "600.50",
    });
  });

  it("rejects numbers with thousand separators (US format)", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "AMOUNT",
    } as CustomField;

    expect(() =>
      buildCustomFieldValue({ raw: "1,234" }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: "1,234.56" }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: "12,345,678.90" }, customField)
    ).toThrowError(ShelfError);
  });

  it("rejects numbers with thousand separators (EU format)", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "AMOUNT",
    } as CustomField;

    expect(() =>
      buildCustomFieldValue({ raw: "1.234" }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: "1.234,56" }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: "12.345.678,90" }, customField)
    ).toThrowError(ShelfError);
  });

  it("handles negative numbers", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "NUMBER",
    } as CustomField;

    expect(buildCustomFieldValue({ raw: "-600" }, customField)).toEqual({
      raw: -600,
      valueText: "-600",
    });

    expect(buildCustomFieldValue({ raw: "(600)" }, customField)).toEqual({
      raw: -600,
      valueText: "-600",
    });

    expect(buildCustomFieldValue({ raw: "600-" }, customField)).toEqual({
      raw: -600,
      valueText: "-600",
    });
  });

  it("handles zero", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "NUMBER",
    } as CustomField;

    expect(buildCustomFieldValue({ raw: "0" }, customField)).toEqual({
      raw: 0,
      valueText: "0",
    });

    expect(buildCustomFieldValue({ raw: "0.00" }, customField)).toEqual({
      raw: 0,
      valueText: "0.00",
    });
  });

  it("rejects NaN and Infinity", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "AMOUNT",
    } as CustomField;

    expect(() => buildCustomFieldValue({ raw: NaN }, customField)).toThrowError(
      ShelfError
    );
    expect(() =>
      buildCustomFieldValue({ raw: Infinity }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: -Infinity }, customField)
    ).toThrowError(ShelfError);
  });

  it("rejects scientific notation", () => {
    const customField: CustomField = {
      ...baseCustomField,
      type: "AMOUNT",
    } as CustomField;

    expect(() =>
      buildCustomFieldValue({ raw: "1e10" }, customField)
    ).toThrowError(ShelfError);
    expect(() =>
      buildCustomFieldValue({ raw: "1E5" }, customField)
    ).toThrowError(ShelfError);
  });
});
