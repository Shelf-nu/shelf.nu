/**
 * What a PDF document prints for each custom field type.
 *
 * @see {@link file://./format.ts}
 */
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDocumentCustomFieldValue } from "./format";

const prefs: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "UTC",
};

function print(
  type: Parameters<typeof formatDocumentCustomFieldValue>[0]["type"],
  value: unknown
) {
  return formatDocumentCustomFieldValue({
    value,
    type,
    currency: "EUR",
    locale: "en-US",
    prefs,
  });
}

describe("PDF document custom field values", () => {
  it("prints an amount in the workspace currency", () => {
    expect(print("AMOUNT", { raw: 85, valueText: "85" })).toBe("€85.00");
  });

  it("prints a date in the user's date format", () => {
    expect(
      print("DATE", {
        raw: "2026-10-28",
        valueDate: "2026-10-28T00:00:00.000Z",
      })
    ).toBe("28/10/2026");
  });

  it("prints a boolean as Yes or No", () => {
    expect(print("BOOLEAN", { raw: true, valueBoolean: true })).toBe("Yes");
    expect(print("BOOLEAN", { raw: false, valueBoolean: false })).toBe("No");
  });

  it("prints text, an option and a number as stored", () => {
    expect(print("TEXT", { raw: "SN-0042", valueText: "SN-0042" })).toBe(
      "SN-0042"
    );
    expect(print("OPTION", { raw: "Red", valueOption: "Red" })).toBe("Red");
    expect(print("NUMBER", { raw: 3, valueText: "3" })).toBe("3");
  });

  it("prints a multi-line text as typed, not as rendered markdown", () => {
    expect(
      print("MULTILINE_TEXT", {
        raw: "Line one\n**Line two**",
        valueMultiLineText: "x",
      })
    ).toBe("Line one\n**Line two**");
  });

  it("prints nothing for a value that was never set or is blank", () => {
    expect(print("TEXT", undefined)).toBeNull();
    expect(print("TEXT", { raw: "" })).toBeNull();
    expect(print("AMOUNT", { raw: null })).toBeNull();
  });
});
