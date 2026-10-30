import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  buildAssetOverviewCustomFields,
  buildCustomFieldValue,
  customFieldCsvHeader,
  extractCustomFieldValuesFromPayload,
  getCustomFieldDisplayValue,
  getDefinitionFromCsvHeader,
  isImportableCustomFieldDate,
  mergedSchema,
  storedCustomFieldTexts,
  toCustomFieldZodSchema,
  type CustomFieldZodSchema,
} from "./custom-fields";

/**
 * Tests for DATE custom-field coercion in {@link buildCustomFieldValue}.
 *
 * Regression guard for the silent import-corruption bug: non-ISO date input
 * (notably dash-separated "03-04-2026") used to be positionally split and
 * stored as a wildly wrong date (~1908) with no error, because the resulting
 * JS Date was technically valid. Import dates are an ISO YYYY-MM-DD contract;
 * anything else must fail loudly rather than corrupt the queryable valueDate.
 */
describe("buildCustomFieldValue — DATE", () => {
  const dateField = {
    id: "cf_date",
    name: "Purchase date",
    type: "DATE",
  } as unknown as CustomField;

  it("accepts a valid ISO YYYY-MM-DD date and stores UTC-midnight valueDate", () => {
    const result = buildCustomFieldValue({ raw: "2026-04-03" }, dateField);

    expect(result).toEqual({
      raw: "2026-04-03",
      valueDate: "2026-04-03T00:00:00.000Z",
    });
  });

  it("rejects dash-separated non-ISO input instead of silently storing a wrong year", () => {
    // why: the original bug — "03-04-2026" → [3,4,2026] → Date.UTC(3,3,2026) ≈ 1908.
    expect(() =>
      buildCustomFieldValue({ raw: "03-04-2026" }, dateField)
    ).toThrowError(/YYYY-MM-DD/);
  });

  it("rejects slash-separated input", () => {
    expect(() =>
      buildCustomFieldValue({ raw: "03/04/2026" }, dateField)
    ).toThrowError(/YYYY-MM-DD/);
  });

  it("rejects an impossible calendar date that JS Date would otherwise roll over", () => {
    // 2026-02-31 would normalize to 2026-03-03 without the round-trip check.
    expect(() =>
      buildCustomFieldValue({ raw: "2026-02-31" }, dateField)
    ).toThrowError(/real calendar date/);
  });

  it("rejects a 13th month", () => {
    expect(() =>
      buildCustomFieldValue({ raw: "2026-13-01" }, dateField)
    ).toThrowError();
  });

  it("returns undefined for an empty value (unchanged skip behavior)", () => {
    expect(buildCustomFieldValue({ raw: "" }, dateField)).toBeUndefined();
  });

  it("trims surrounding whitespace before validating", () => {
    const result = buildCustomFieldValue({ raw: "  2026-04-03  " }, dateField);

    expect(result).toEqual({
      raw: "2026-04-03",
      valueDate: "2026-04-03T00:00:00.000Z",
    });
  });
});

describe("getCustomFieldDisplayValue — DATE with prefs", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a DATE value in the user's configured order when prefs are given", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never, prefs)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("falls back to PPP when no prefs are supplied", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never)).toBe("April 3rd, 2026");
  });
});

/**
 * Regression guard for the view-only blindness bug.
 *
 * The asset-overview loader only fetches the org's active custom-field
 * DEFINITIONS for users who can update the asset (a perf optimization). The
 * page then built its entire custom-fields list from that array, so BASE and
 * SELF_SERVICE users — who hold `asset: [read]` and never `asset: update` —
 * saw an empty definitions array and therefore NO custom fields at all, even
 * on assets where values were set.
 *
 * The stored values already carry their own definition, so the list must be
 * seeded from the values and only TOPPED UP with editable definitions.
 */
describe("buildAssetOverviewCustomFields", () => {
  const def = (id: string, name: string) => ({
    id,
    name,
    type: "TEXT" as const,
    format: "PLAIN" as const,
    options: [],
    helpText: null,
    required: false,
  });

  const storedValue = (id: string, name: string, raw: string) => ({
    value: { raw },
    customField: def(id, name),
  });

  it("shows fields that have values when there are no editable definitions", () => {
    // why: this is exactly the BASE / SELF_SERVICE payload — the loader sends
    // `allCustomFieldDefs: []` because they cannot update the asset.
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].def.name).toBe("Serial number");
    expect(result[0].storedValue?.value).toEqual({ raw: "ABC-123" });
    // Visible, but not editable — they hold `asset: [read]`, not `update`.
    expect(result[0].isEditable).toBe(false);
  });

  it("adds definitions with no stored value so editors get 'Not set' rows", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [
        def("cf1", "Serial number"),
        def("cf2", "Warranty"),
      ],
    });

    expect(result.map((r) => r.def.name)).toEqual([
      "Serial number",
      "Warranty",
    ]);
    expect(result[1].storedValue).toBeNull();
  });

  it("does not duplicate a field present in both sources", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [def("cf1", "Serial number")],
    });

    expect(result).toHaveLength(1);
    expect(result[0].storedValue).not.toBeNull();
  });

  it("keeps a stored value whose definition is missing from the editable set", () => {
    // why: an uncategorized asset only gets UNCATEGORIZED definitions back, so
    // a value left behind by a category-scoped field would otherwise vanish —
    // for admins and owners too.
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf-orphan", "Lens mount", "EF")],
      editableDefinitions: [def("cf2", "Warranty")],
    });

    expect(result.map((r) => r.def.name)).toEqual(["Lens mount", "Warranty"]);
    expect(result[0].storedValue).not.toBeNull();
    // The route's action refuses writes for out-of-scope definitions, so the
    // row must render read-only rather than dead-end on a 400.
    expect(result[0].isEditable).toBe(false);
    expect(result[1].isEditable).toBe(true);
  });

  it("ignores stored rows with an empty value", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [{ value: null, customField: def("cf1", "Serial number") }],
      editableDefinitions: [],
    });

    expect(result).toEqual([]);
  });

  it("sorts alphabetically without mutating the caller's arrays", () => {
    const editableDefinitions = [def("cf-z", "Zoom"), def("cf-a", "Aperture")];

    const result = buildAssetOverviewCustomFields({
      storedValues: [],
      editableDefinitions,
    });

    expect(result.map((r) => r.def.name)).toEqual(["Aperture", "Zoom"]);
    // The loader payload must stay untouched — `.sort()` in place would
    // reorder data React may re-render from.
    expect(editableDefinitions.map((d) => d.name)).toEqual([
      "Zoom",
      "Aperture",
    ]);
  });
});

/**
 * Required numeric custom fields.
 *
 * "Required" means a value was given, not that the value is non-zero. Zero is an
 * ordinary number (a count of nothing, a price of nothing), and a required
 * field that refuses it cannot be satisfied by an operator whose answer is 0.
 */
describe("mergedSchema: required numeric fields accept zero", () => {
  /** Builds the merged schema for one required field of the given type. */
  function schemaFor(type: "number" | "amount") {
    return mergedSchema({
      baseSchema: z.object({}),
      customFields: [
        {
          id: "cf1",
          name: "Shelf count",
          type,
          helpText: "",
          required: true,
        } satisfies CustomFieldZodSchema,
      ],
    });
  }

  it.each(["number", "amount"] as const)(
    "accepts 0 for a required %s field",
    (type) => {
      const result = schemaFor(type).safeParse({ "cf-cf1": "0" });

      expect(result.success).toBe(true);
      if (result.success) {
        // `buildSchema` composes the shape from field definitions at runtime, so
        // the `cf-<id>` key is not statically knowable; read it as unknown data
        // rather than widening the schema's inferred type.
        const parsed = result.data as Record<string, unknown>;
        expect(parsed["cf-cf1"]).toBe(0);
      }
    }
  );

  it.each(["number", "amount"] as const)(
    "still rejects an empty required %s field",
    (type) => {
      const result = schemaFor(type).safeParse({ "cf-cf1": "" });

      expect(result.success).toBe(false);
    }
  );

  it("accepts a negative value for a required number field", () => {
    const result = schemaFor("number").safeParse({ "cf-cf1": "-5" });

    expect(result.success).toBe(true);
  });

  it("rejects a whitespace-only required number field", () => {
    const result = schemaFor("number").safeParse({ "cf-cf1": "   " });

    expect(result.success).toBe(false);
  });

  it.each(["number", "amount"] as const)(
    "names the field when a required %s field is omitted",
    (type) => {
      const result = schemaFor(type).safeParse({});

      expect(result.success).toBe(false);
      if (!result.success) {
        // A union type error ("Expected string, received undefined") would be
        // true and useless. The operator has to be told which field to fill in.
        expect(result.error.issues[0].message).toBe("Shelf count is required");
      }
    }
  );

  it("rejects a non-numeric required number field", () => {
    const result = schemaFor("number").safeParse({ "cf-cf1": "abc" });

    expect(result.success).toBe(false);
  });
});

/**
 * Optional numeric custom fields.
 *
 * A blank one must stay blank. `z.coerce.number()` reads `""` as `0`, and the
 * downstream blank guard in `buildCustomFieldValue` cannot undo that: it drops an
 * undefined, null or whitespace RAW value, and by the time it runs the value is
 * the number `0`. So an operator who left a numeric field empty had a zero
 * recorded for it.
 */
describe("mergedSchema: optional numeric fields keep blank blank", () => {
  function schemaFor(type: "number" | "amount") {
    return mergedSchema({
      baseSchema: z.object({}),
      customFields: [
        {
          id: "cf1",
          name: "Shelf count",
          type,
          helpText: "",
          required: false,
        } satisfies CustomFieldZodSchema,
      ],
    });
  }

  it.each(["number", "amount"] as const)(
    "reads a blank optional %s field as absent, not zero",
    (type) => {
      const result = schemaFor(type).safeParse({ "cf-cf1": "" });

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = result.data as Record<string, unknown>;
        expect(parsed["cf-cf1"]).toBeNull();
      }
    }
  );

  it.each(["number", "amount"] as const)(
    "reads a whitespace-only optional %s field as absent",
    (type) => {
      const result = schemaFor(type).safeParse({ "cf-cf1": "   " });

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = result.data as Record<string, unknown>;
        expect(parsed["cf-cf1"]).toBeNull();
      }
    }
  );

  it("still keeps a deliberate zero on an optional field", () => {
    const result = schemaFor("number").safeParse({ "cf-cf1": "0" });

    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as Record<string, unknown>;
      expect(parsed["cf-cf1"]).toBe(0);
    }
  });
});

describe("isImportableCustomFieldDate", () => {
  it("accepts a real YYYY-MM-DD day, as the importer stores it", () => {
    expect(isImportableCustomFieldDate("2024-02-29")).toBe(true);
  });

  it("refuses other formats and days that do not exist", () => {
    expect(isImportableCustomFieldDate("23/06/2024")).toBe(false);
    expect(isImportableCustomFieldDate("2026-02-31")).toBe(false);
    expect(isImportableCustomFieldDate("2023-02-29")).toBe(false);
  });

  it("agrees with buildCustomFieldValue on every case", () => {
    for (const raw of ["2024-02-29", "2026-02-31", "03-04-2026"]) {
      let stored = true;
      try {
        buildCustomFieldValue({ raw }, {
          name: "Bought",
          type: "DATE",
        } as Parameters<typeof buildCustomFieldValue>[1]);
      } catch {
        stored = false;
      }
      expect(isImportableCustomFieldDate(raw)).toBe(stored);
    }
  });
});

/**
 * A Link-format TEXT field takes web links only, on every write path, because
 * every path builds its value here. A plain TEXT field keeps any text.
 */
describe("buildCustomFieldValue for Link fields", () => {
  const linkField = {
    id: "cf_manual",
    name: "Manual",
    type: "TEXT",
    format: "LINK",
  } as const;

  it("stores a link without a scheme as an https link", () => {
    expect(
      buildCustomFieldValue({ raw: " www.example.com/a.pdf " }, linkField)
    ).toEqual({
      raw: "https://www.example.com/a.pdf",
      valueText: "https://www.example.com/a.pdf",
    });
  });

  it("refuses text that is not a link with a 400 naming the field and the value", () => {
    let thrown: unknown;
    try {
      buildCustomFieldValue({ raw: "see shelf" }, linkField);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message:
        "Custom field 'Manual': Enter just the link, with no spaces or other text. The value we found is: 'see shelf'.",
    });
  });

  it("leaves a blank value unset", () => {
    expect(buildCustomFieldValue({ raw: "  " }, linkField)).toBeUndefined();
  });

  it("keeps any text in a plain TEXT field", () => {
    expect(
      buildCustomFieldValue(
        { raw: "see shelf" },
        { ...linkField, format: "PLAIN" }
      )
    ).toEqual({ raw: "see shelf", valueText: "see shelf" });
  });
});

describe("toCustomFieldZodSchema for Link fields", () => {
  const schema = mergedSchema({
    baseSchema: z.object({}),
    customFields: [
      toCustomFieldZodSchema({
        id: "manual",
        name: "Manual",
        helpText: null,
        required: false,
        type: "TEXT",
        format: "LINK",
        options: [],
      }),
    ],
  });

  it("refuses text that is not a web link", () => {
    const result = schema.safeParse({ "cf-manual": "see shelf" });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter just the link, with no spaces or other text",
    ]);
  });

  it("accepts a web link and a blank optional value", () => {
    expect(
      schema.safeParse({ "cf-manual": "www.example.com/a.pdf" }).success
    ).toBe(true);
    expect(schema.safeParse({ "cf-manual": "" }).success).toBe(true);
  });
});

describe("editing an asset whose Link field holds an older plain value", () => {
  const manual: Parameters<typeof toCustomFieldZodSchema>[0] = {
    id: "manual",
    name: "Manual",
    helpText: null,
    required: false,
    type: "TEXT",
    format: "LINK",
    options: [],
  };
  // The asset's stored values, as the edit loader and action read them.
  const storedValues = storedCustomFieldTexts([
    {
      customFieldId: "manual",
      value: { raw: "see binder 4", valueText: "see binder 4" },
    },
  ]);
  const schema = mergedSchema({
    baseSchema: z.object({ title: z.string() }),
    customFields: [toCustomFieldZodSchema(manual)],
    storedValues,
  });

  it("accepts the stored value unchanged beside a new title", () => {
    expect(
      schema.safeParse({ title: "Camera 2", "cf-manual": "see binder 4" })
    ).toEqual({
      success: true,
      data: { title: "Camera 2", "cf-manual": "see binder 4" },
    });
  });

  it("still refuses a changed value that is not a link", () => {
    const result = schema.safeParse({
      title: "Camera 2",
      "cf-manual": "see binder 5",
    });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter just the link, with no spaces or other text",
    ]);
  });

  it("leaves the unchanged value out of the write, and builds a changed link", () => {
    const customFieldDef = [manual as unknown as CustomField];

    expect(
      extractCustomFieldValuesFromPayload({
        payload: { title: "Camera 2", "cf-manual": "see binder 4" },
        customFieldDef,
        storedValues,
      })
    ).toEqual([]);
    expect(
      extractCustomFieldValuesFromPayload({
        payload: { "cf-manual": "www.example.com/manual.pdf" },
        customFieldDef,
        storedValues,
      })
    ).toEqual([
      {
        id: "manual",
        value: {
          raw: "https://www.example.com/manual.pdf",
          valueText: "https://www.example.com/manual.pdf",
        },
      },
    ]);
  });
});

describe("custom field CSV headers", () => {
  it("reads format:link on a text column as a Link field", () => {
    expect(
      getDefinitionFromCsvHeader("cf:Manual, type:text, format:link")
    ).toMatchObject({ name: "Manual", type: "TEXT", format: "LINK" });
  });

  it("reads a header without a format as plain text", () => {
    expect(getDefinitionFromCsvHeader("cf:Serial,type:text")).toMatchObject({
      name: "Serial",
      type: "TEXT",
      format: "PLAIN",
    });
  });

  it("ignores format:link on a column that is not single-line text", () => {
    expect(
      getDefinitionFromCsvHeader("cf:Notes,type:multiline text,format:link")
    ).toMatchObject({ type: "MULTILINE_TEXT", format: "PLAIN" });
  });

  it("writes headers that read back as the same field", () => {
    const link = { name: "Manual", type: "TEXT", format: "LINK" } as const;
    const plain = { name: "Serial", type: "TEXT", format: "PLAIN" } as const;

    expect(customFieldCsvHeader(link)).toBe("cf:Manual,type:TEXT,format:LINK");
    expect(customFieldCsvHeader(plain)).toBe("cf:Serial,type:TEXT");
    expect(
      getDefinitionFromCsvHeader(customFieldCsvHeader(link))
    ).toMatchObject(link);
    expect(
      getDefinitionFromCsvHeader(customFieldCsvHeader(plain))
    ).toMatchObject(plain);
  });
});
