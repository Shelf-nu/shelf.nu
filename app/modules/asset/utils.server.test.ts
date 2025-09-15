import {
  compareCustomFieldValues,
  detectPotentialChanges,
  detectCustomFieldChanges,
  getCustomFieldUpdateNoteContent,
  type CustomFieldChangeInfo,
} from "./utils.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock the custom fields utility to control return values
vitest.mock("~/utils/custom-fields", () => ({
  getCustomFieldDisplayValue: vitest.fn((value: any) => {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (value.raw) return String(value.raw);
    return String(value);
  }),
}));

describe("compareCustomFieldValues", () => {
  describe("null/undefined handling", () => {
    it("should return false when both values are null", () => {
      const result = compareCustomFieldValues(null, null, "TEXT");
      expect(result).toBe(false);
    });

    it("should return false when both values are undefined", () => {
      const result = compareCustomFieldValues(undefined, undefined, "TEXT");
      expect(result).toBe(false);
    });

    it("should return true when old value is null and new value exists", () => {
      const result = compareCustomFieldValues(null, { raw: "new" }, "TEXT");
      expect(result).toBe(true);
    });

    it("should return true when new value is null and old value exists", () => {
      const result = compareCustomFieldValues({ raw: "old" }, null, "TEXT");
      expect(result).toBe(true);
    });
  });

  describe("DATE type comparison", () => {
    it("should return false for identical dates", () => {
      const date = "2024-01-15";
      const oldValue = { raw: date };
      const newValue = { raw: date };

      const result = compareCustomFieldValues(oldValue, newValue, "DATE");
      expect(result).toBe(false);
    });

    it("should return true for different dates", () => {
      const oldValue = { raw: "2024-01-15" };
      const newValue = { raw: "2024-01-16" };

      const result = compareCustomFieldValues(oldValue, newValue, "DATE");
      expect(result).toBe(true);
    });

    it("should fallback to string comparison for invalid dates", () => {
      const oldValue = { raw: "invalid-date" };
      const newValue = { raw: "another-invalid" };

      const result = compareCustomFieldValues(oldValue, newValue, "DATE");
      expect(result).toBe(true);
    });

    it("should return false for invalid dates that are identical", () => {
      const invalidDate = "not-a-date";
      const oldValue = { raw: invalidDate };
      const newValue = { raw: invalidDate };

      const result = compareCustomFieldValues(oldValue, newValue, "DATE");
      expect(result).toBe(false); // String comparison: "not-a-date" === "not-a-date"
    });
  });

  describe("BOOLEAN type comparison", () => {
    it("should return false for identical boolean values", () => {
      const oldValue = { raw: true };
      const newValue = { raw: true };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(false);
    });

    it("should return true for different boolean values", () => {
      const oldValue = { raw: true };
      const newValue = { raw: false };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(true);
    });

    it("should handle truthy/falsy conversion correctly", () => {
      const oldValue = { raw: 1 };
      const newValue = { raw: 0 };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(true);
    });

    it("should handle string boolean conversion", () => {
      const oldValue = { raw: "true" };
      const newValue = { raw: "false" };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(true); // "true" normalizes to true, "false" normalizes to false
    });

    it("should handle numeric boolean conversion", () => {
      const oldValue = { raw: "1" };
      const newValue = { raw: "0" };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(true); // "1" normalizes to true, "0" normalizes to false
    });

    it("should handle case-insensitive boolean strings", () => {
      const oldValue = { raw: "TRUE" };
      const newValue = { raw: "true" };

      const result = compareCustomFieldValues(oldValue, newValue, "BOOLEAN");
      expect(result).toBe(false); // Both normalize to true
    });
  });

  describe("NUMBER type comparison", () => {
    it("should return false for identical numbers", () => {
      const oldValue = { raw: 42 };
      const newValue = { raw: 42 };

      const result = compareCustomFieldValues(oldValue, newValue, "NUMBER");
      expect(result).toBe(false);
    });

    it("should return true for different numbers", () => {
      const oldValue = { raw: 42 };
      const newValue = { raw: 43 };

      const result = compareCustomFieldValues(oldValue, newValue, "NUMBER");
      expect(result).toBe(true);
    });

    it("should handle string number conversion", () => {
      const oldValue = { raw: "42" };
      const newValue = { raw: "42.0" };

      const result = compareCustomFieldValues(oldValue, newValue, "NUMBER");
      expect(result).toBe(false); // Both convert to 42
    });

    it("should return true for string vs number", () => {
      const oldValue = { raw: "42" };
      const newValue = { raw: "43" };

      const result = compareCustomFieldValues(oldValue, newValue, "NUMBER");
      expect(result).toBe(true);
    });
  });

  describe("TEXT/default type comparison", () => {
    it("should return false for identical objects", () => {
      const value = { raw: "text", display: "Text" };
      const oldValue = value;
      const newValue = value;

      const result = compareCustomFieldValues(oldValue, newValue, "TEXT");
      expect(result).toBe(false);
    });

    it("should return true for different objects with same raw value but different structure", () => {
      const oldValue = { raw: "text" };
      const newValue = { raw: "text", display: "Text" };

      const result = compareCustomFieldValues(oldValue, newValue, "TEXT");
      expect(result).toBe(true);
    });

    it("should return true for different raw values", () => {
      const oldValue = { raw: "old text" };
      const newValue = { raw: "new text" };

      const result = compareCustomFieldValues(oldValue, newValue, "TEXT");
      expect(result).toBe(true);
    });
  });
});

describe("detectPotentialChanges", () => {
  it("should detect no changes when arrays are empty", () => {
    const result = detectPotentialChanges([], []);
    expect(result).toEqual([]);
  });

  it("should detect first time value setting", () => {
    const existingValues: any[] = [];
    const formValues = [{ id: "field1", value: { raw: "new value" } }];

    const result = detectPotentialChanges(existingValues, formValues);
    expect(result).toEqual([{ fieldId: "field1", hasChange: true }]);
  });

  it("should detect value removal", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "existing" },
      },
    ];
    const formValues = [{ id: "field1", value: null }];

    const result = detectPotentialChanges(existingValues, formValues);
    expect(result).toEqual([{ fieldId: "field1", hasChange: true }]);
  });

  it("should detect value changes", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "old value" },
      },
    ];
    const formValues = [{ id: "field1", value: { raw: "new value" } }];

    const result = detectPotentialChanges(existingValues, formValues);
    expect(result).toEqual([{ fieldId: "field1", hasChange: true }]);
  });

  it("should not detect changes when values are identical", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "same value" },
      },
    ];
    const formValues = [{ id: "field1", value: { raw: "same value" } }];

    const result = detectPotentialChanges(existingValues, formValues);
    expect(result).toEqual([]);
  });

  it("should handle multiple fields with mixed changes", () => {
    const existingValues = [
      { id: "value1", customFieldId: "field1", value: { raw: "old" } },
      { id: "value2", customFieldId: "field2", value: { raw: "same" } },
    ];
    const formValues = [
      { id: "field1", value: { raw: "new" } }, // Changed
      { id: "field2", value: { raw: "same" } }, // No change
      { id: "field3", value: { raw: "first time" } }, // New
    ];

    const result = detectPotentialChanges(existingValues, formValues);
    expect(result).toEqual([
      { fieldId: "field1", hasChange: true },
      { fieldId: "field3", hasChange: true },
    ]);
  });
});

describe("detectCustomFieldChanges", () => {
  const mockCustomFields = [
    { id: "field1", name: "Serial Number", type: "TEXT" },
    { id: "field2", name: "Purchase Date", type: "DATE" },
    { id: "field3", name: "Is Active", type: "BOOLEAN" },
  ];

  it("should detect first time field setting", () => {
    const existingValues: any[] = [];
    const formValues = [{ id: "field1", value: { raw: "SN123456" } }];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Serial Number",
        previousValue: null,
        newValue: "SN123456",
        isFirstTimeSet: true,
      },
    ]);
  });

  it("should detect field value removal", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "SN123456" },
        customField: { id: "field1", name: "Serial Number", type: "TEXT" },
      },
    ];
    const formValues = [{ id: "field1", value: null }];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Serial Number",
        previousValue: "SN123456",
        newValue: null,
        isFirstTimeSet: false,
      },
    ]);
  });

  it("should detect field value changes", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "SN123456" },
        customField: { id: "field1", name: "Serial Number", type: "TEXT" },
      },
    ];
    const formValues = [{ id: "field1", value: { raw: "SN789012" } }];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Serial Number",
        previousValue: "SN123456",
        newValue: "SN789012",
        isFirstTimeSet: false,
      },
    ]);
  });

  it("should not detect changes when values are identical", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "SN123456" },
        customField: { id: "field1", name: "Serial Number", type: "TEXT" },
      },
    ];
    const formValues = [{ id: "field1", value: { raw: "SN123456" } }];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([]);
  });

  it("should skip fields not found in custom field definitions", () => {
    const existingValues: any[] = [];
    const formValues = [{ id: "unknown-field", value: { raw: "value" } }];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([]);
  });

  it("should handle multiple field changes correctly", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { raw: "SN123456" },
        customField: { id: "field1", name: "Serial Number", type: "TEXT" },
      },
      {
        id: "value2",
        customFieldId: "field2",
        value: { raw: "2024-01-15" },
        customField: { id: "field2", name: "Purchase Date", type: "DATE" },
      },
    ];
    const formValues = [
      { id: "field1", value: { raw: "SN789012" } }, // Changed
      { id: "field2", value: { raw: "2024-01-15" } }, // No change
      { id: "field3", value: { raw: true } }, // New field
    ];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Serial Number",
        previousValue: "SN123456",
        newValue: "SN789012",
        isFirstTimeSet: false,
      },
      {
        customFieldName: "Is Active",
        previousValue: null,
        newValue: "true",
        isFirstTimeSet: true,
      },
    ]);
  });
});

describe("getCustomFieldUpdateNoteContent", () => {
  it("should generate note for first time field setting", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: "SN123456",
      firstName: "John",
      lastName: "Doe",
      assetName: "Laptop Asset",
      isFirstTimeSet: true,
    });

    expect(result).toBe(
      "**John Doe** set **Serial Number** of **Laptop Asset** to **SN123456**"
    );
  });

  it("should generate note for field value update", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Warranty Status",
      previousValue: "Active",
      newValue: "Expired",
      firstName: "Jane",
      lastName: "Smith",
      assetName: "Camera Equipment",
      isFirstTimeSet: false,
    });

    expect(result).toBe(
      "**Jane Smith** updated **Warranty Status** of **Camera Equipment** from **Active** to **Expired**"
    );
  });

  it("should generate note for field value removal", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Purchase Order",
      previousValue: "PO-2024-001",
      newValue: null,
      firstName: "Bob",
      lastName: "Johnson",
      assetName: "Office Chair",
      isFirstTimeSet: false,
    });

    expect(result).toBe(
      "**Bob Johnson** removed **Purchase Order** value **PO-2024-001** from **Office Chair**"
    );
  });

  it("should handle names with extra whitespace", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: "SN123456",
      firstName: "  John  ",
      lastName: "  Doe  ",
      assetName: "  Laptop Asset  ",
      isFirstTimeSet: true,
    });

    expect(result).toBe(
      "**John Doe** set **Serial Number** of **Laptop Asset** to **SN123456**"
    );
  });

  it("should return empty string for invalid scenarios", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: null,
      firstName: "John",
      lastName: "Doe",
      assetName: "Laptop Asset",
      isFirstTimeSet: false,
    });

    expect(result).toBe("");
  });

  it("should handle missing new value for first time set", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: null,
      firstName: "John",
      lastName: "Doe",
      assetName: "Laptop Asset",
      isFirstTimeSet: true,
    });

    expect(result).toBe("");
  });
});
