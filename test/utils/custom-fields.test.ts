import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildCustomFieldValue } from "~/utils/custom-fields";
import { ShelfError } from "~/utils/error";

const baseCustomField: Omit<CustomField, "type"> & {
  type: CustomField["type"];
} = {
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

  it("sanitizes european formatted NUMBER values", () => {
    const customField: CustomField = {
      ...baseCustomField,
      name: "Quantity",
      type: "NUMBER",
    } as CustomField;

    const result = buildCustomFieldValue({ raw: "€1.234,56" }, customField);

    expect(result).toEqual({ raw: 1234.56, valueText: "1234.56" });
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
      "Custom field 'Budget' has invalid numeric value 'invalid'. Please use plain numbers without currency symbols or letters (e.g., 600.00)."
    );
  });
});
