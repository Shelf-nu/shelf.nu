import { AssetType, type CustomFieldType } from "@prisma/client";
import {
  compareCustomFieldValues,
  detectPotentialChanges,
  detectCustomFieldChanges,
  getCustomFieldUpdateNoteContent,
  getKitLocationUpdateNoteContent,
  getLocationUpdateNoteContent,
} from "./utils.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: prevent DB connections when utils import transitively reaches location descendants helper
vitest.mock("~/modules/location/descendants.server", () => ({
  getLocationDescendantIds: vitest.fn().mockResolvedValue([]),
}));

// why: controlling display value formatting for different custom field types (boolean, multiline text) in note generation tests
vitest.mock("~/utils/custom-fields", () => ({
  getCustomFieldDisplayValue: vitest.fn((value: any) => {
    if (!value) return null;

    // Simulate boolean field behavior
    if (Object.hasOwnProperty.call(value, "valueBoolean")) {
      return value.valueBoolean ? "Yes" : "No";
    }

    // Simulate multi-line text field behavior (returns React node object)
    if (value.valueMultiLineText) {
      return { type: "div", children: "rendered markdown" }; // Mock React node
    }

    // Default behavior
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
    { id: "field1", name: "Serial Number", type: "TEXT" as CustomFieldType },
    { id: "field2", name: "Purchase Date", type: "DATE" as CustomFieldType },
    { id: "field3", name: "Is Active", type: "BOOLEAN" as CustomFieldType },
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
        customField: {
          id: "field1",
          name: "Serial Number",
          type: "TEXT" as CustomFieldType,
        },
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
        customField: {
          id: "field1",
          name: "Serial Number",
          type: "TEXT" as CustomFieldType,
        },
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
        customField: {
          id: "field1",
          name: "Serial Number",
          type: "TEXT" as CustomFieldType,
        },
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
        customField: {
          id: "field1",
          name: "Serial Number",
          type: "TEXT" as CustomFieldType,
        },
      },
      {
        id: "value2",
        customFieldId: "field2",
        value: { raw: "2024-01-15" },
        customField: {
          id: "field2",
          name: "Purchase Date",
          type: "DATE" as CustomFieldType,
        },
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
      userId: "user-123",
      firstName: "John",
      lastName: "Doe",
      isFirstTimeSet: true,
    });

    expect(result).toBe(
      '{% link to="/settings/team/users/user-123" text="John Doe" /%} set **Serial Number** to **SN123456**.'
    );
  });

  it("should generate note for field value update", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Warranty Status",
      previousValue: "Active",
      newValue: "Expired",
      userId: "user-456",
      firstName: "Jane",
      lastName: "Smith",
      isFirstTimeSet: false,
    });

    expect(result).toBe(
      '{% link to="/settings/team/users/user-456" text="Jane Smith" /%} updated **Warranty Status** from **Active** to **Expired**.'
    );
  });

  it("should generate note for field value removal", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Purchase Order",
      previousValue: "PO-2024-001",
      newValue: null,
      userId: "user-789",
      firstName: "Bob",
      lastName: "Johnson",
      isFirstTimeSet: false,
    });

    expect(result).toBe(
      '{% link to="/settings/team/users/user-789" text="Bob Johnson" /%} removed **Purchase Order** value **PO-2024-001**.'
    );
  });

  it("should handle names with extra whitespace", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: "SN123456",
      userId: "user-123",
      firstName: "  John  ",
      lastName: "  Doe  ",
      isFirstTimeSet: true,
    });

    expect(result).toBe(
      '{% link to="/settings/team/users/user-123" text="John Doe" /%} set **Serial Number** to **SN123456**.'
    );
  });

  it("should return empty string for invalid scenarios", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: null,
      userId: "user-123",
      firstName: "John",
      lastName: "Doe",
      isFirstTimeSet: false,
    });

    expect(result).toBe("");
  });

  it("should handle missing new value for first time set", () => {
    const result = getCustomFieldUpdateNoteContent({
      customFieldName: "Serial Number",
      previousValue: null,
      newValue: null,
      userId: "user-123",
      firstName: "John",
      lastName: "Doe",
      isFirstTimeSet: true,
    });

    expect(result).toBe("");
  });
});

describe("detectCustomFieldChanges - Display Value Formatting", () => {
  const mockCustomFields = [
    { id: "field1", name: "Is Active", type: "BOOLEAN" as CustomFieldType },
    {
      id: "field2",
      name: "Description",
      type: "MULTILINE_TEXT" as CustomFieldType,
    },
  ];

  it("should properly format boolean values in notes", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field1",
        value: { valueBoolean: true, raw: true },
        customField: {
          id: "field1",
          name: "Is Active",
          type: "BOOLEAN" as CustomFieldType,
        },
      },
    ];
    const formValues = [
      { id: "field1", value: { valueBoolean: false, raw: false } },
    ];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Is Active",
        previousValue: "Yes",
        newValue: "No",
        isFirstTimeSet: false,
      },
    ]);
  });

  it("should handle multi-line text fields without [object Object]", () => {
    const existingValues = [
      {
        id: "value1",
        customFieldId: "field2",
        value: { valueMultiLineText: true, raw: "Old markdown content" },
        customField: {
          id: "field2",
          name: "Description",
          type: "MULTILINE_TEXT" as CustomFieldType,
        },
      },
    ];
    const formValues = [
      {
        id: "field2",
        value: { valueMultiLineText: true, raw: "New markdown content" },
      },
    ];

    const result = detectCustomFieldChanges(
      existingValues,
      formValues,
      mockCustomFields
    );

    expect(result).toEqual([
      {
        customFieldName: "Description",
        previousValue: "Old markdown content",
        newValue: "New markdown content",
        isFirstTimeSet: false,
      },
    ]);
  });
});

describe("getLocationUpdateNoteContent", () => {
  const userArgs = {
    userId: "u1",
    firstName: "Alex",
    lastName: "Doe",
  };
  const officeA = { id: "loc-a", name: "Office A" };
  const officeB = { id: "loc-b", name: "Office B" };

  describe("INDIVIDUAL phrasing (unchanged)", () => {
    it("renders the original 'set the location' phrasing without a count", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: null,
        newLocation: officeA,
        type: AssetType.INDIVIDUAL,
      });

      expect(result).toContain("set the location to");
      expect(result).toContain("Office A");
      expect(result).not.toMatch(/\d+\s+units?/);
    });

    it("renders the original 'updated the location from … to …' phrasing", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: officeA,
        newLocation: officeB,
        type: AssetType.INDIVIDUAL,
      });

      expect(result).toContain("updated the location from");
      expect(result).toContain("Office A");
      expect(result).toContain("Office B");
      expect(result).not.toMatch(/\d+\s+units?/);
    });

    it("renders the original 'removed the asset from location' phrasing", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: officeA,
        newLocation: null,
        isRemoving: true,
        type: AssetType.INDIVIDUAL,
      });

      expect(result).toContain("removed the asset from location");
      expect(result).toContain("Office A");
      expect(result).not.toMatch(/\d+\s+units?/);
    });

    it("falls back to the original phrasing when type/quantity are omitted (back-compat)", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: null,
        newLocation: officeA,
      });

      expect(result).toContain("set the location to");
      expect(result).not.toMatch(/\d+\s+units?/);
    });
  });

  describe("QUANTITY_TRACKED phrasing (units)", () => {
    it("renders 'placed N units at L' when setting a first location", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: null,
        newLocation: officeA,
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
      });

      expect(result).toContain("placed 50 units at");
      expect(result).toContain("Office A");
      expect(result).not.toContain("set the location");
    });

    it("renders 'moved N units from A to B' when changing locations", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: officeA,
        newLocation: officeB,
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
      });

      expect(result).toContain("moved 50 units from");
      expect(result).toContain("Office A");
      expect(result).toContain("Office B");
      expect(result).not.toContain("updated the location");
    });

    it("renders 'removed N units from L' when unplacing", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: officeA,
        newLocation: null,
        isRemoving: true,
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
      });

      expect(result).toContain("removed 50 units from");
      expect(result).toContain("Office A");
      expect(result).not.toContain("removed the asset from location");
    });

    it("uses the asset's unitOfMeasure label when supplied", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: null,
        newLocation: officeA,
        type: AssetType.QUANTITY_TRACKED,
        unitOfMeasure: "boxes",
        quantity: 12,
      });

      expect(result).toContain("placed 12 boxes at");
    });

    it("falls back to original phrasing when quantity is missing for qty-tracked", () => {
      const result = getLocationUpdateNoteContent({
        ...userArgs,
        currentLocation: null,
        newLocation: officeA,
        type: AssetType.QUANTITY_TRACKED,
        quantity: null,
      });

      // formatUnitCount returns null for null qty → original phrasing
      expect(result).toContain("set the location to");
      expect(result).not.toMatch(/\d+\s+units?/);
    });
  });
});

describe("getKitLocationUpdateNoteContent", () => {
  const userArgs = {
    userId: "u1",
    firstName: "Alex",
    lastName: "Doe",
  };
  const officeA = { id: "loc-a", name: "Office A" };

  it("appends the kit-assignment suffix to the original INDIVIDUAL phrase", () => {
    const result = getKitLocationUpdateNoteContent({
      ...userArgs,
      currentLocation: null,
      newLocation: officeA,
      isRemoving: false,
      type: AssetType.INDIVIDUAL,
    });

    expect(result).toContain("set the location to");
    expect(result).toContain("Office A");
    expect(result.endsWith("via parent kit assignment.")).toBe(true);
    expect(result).not.toMatch(/\d+\s+units?/);
  });

  it("appends the kit-removal suffix to the original INDIVIDUAL phrase", () => {
    const result = getKitLocationUpdateNoteContent({
      ...userArgs,
      currentLocation: officeA,
      newLocation: null,
      isRemoving: true,
      type: AssetType.INDIVIDUAL,
    });

    expect(result).toContain("removed the asset from location");
    expect(result.endsWith("via parent kit removal.")).toBe(true);
  });

  it("renders 'placed N units at L … via parent kit assignment.' for qty-tracked", () => {
    const result = getKitLocationUpdateNoteContent({
      ...userArgs,
      currentLocation: null,
      newLocation: officeA,
      isRemoving: false,
      type: AssetType.QUANTITY_TRACKED,
      quantity: 50,
    });

    expect(result).toContain("placed 50 units at");
    expect(result).toContain("Office A");
    expect(result.endsWith("via parent kit assignment.")).toBe(true);
  });

  it("renders 'removed N units from L … via parent kit removal.' for qty-tracked", () => {
    const result = getKitLocationUpdateNoteContent({
      ...userArgs,
      currentLocation: officeA,
      newLocation: null,
      isRemoving: true,
      type: AssetType.QUANTITY_TRACKED,
      quantity: 50,
    });

    expect(result).toContain("removed 50 units from");
    expect(result).toContain("Office A");
    expect(result.endsWith("via parent kit removal.")).toBe(true);
  });
});
