/**
 * Tests for the CSV cell helpers (`~/utils/csv-cells`).
 *
 * The contract under test: a multi-value cell (`tags`, `barcode_<Type>`) is a
 * comma-separated list whose items follow CSV's own quoting rules, so an item
 * may itself contain a comma, a quote or edge whitespace and still survive a
 * round trip. A plain `a,b,c` must keep meaning three items, and a leading
 * quote must be read as opening a quoted item — see the module JSDoc for why
 * that last one cannot also preserve a literal leading quote.
 *
 * @see {@link file://./csv-cells.ts}
 */
import { describe, expect, it } from "vitest";

import {
  decodeCsvListCell,
  encodeCsvListCell,
  neutraliseCsvFormula,
} from "./csv-cells";

describe("neutraliseCsvFormula", () => {
  it("prefixes every value a spreadsheet would run", () => {
    expect(
      ["=1+1", "+cmd", "-20C Freezer", "@SUM(A1)"].map((v) =>
        neutraliseCsvFormula(v)
      )
    ).toEqual(["'=1+1", "'+cmd", "'-20C Freezer", "'@SUM(A1)"]);
  });

  it("neutralises a leading tab or carriage return, even for signed text", () => {
    expect(neutraliseCsvFormula("\t=1+1")).toBe("'\t=1+1");
    expect(neutraliseCsvFormula("\r=1")).toBe("'\r=1");
    expect(neutraliseCsvFormula("\t-20C", { keepSignedText: true })).toBe(
      "'\t-20C"
    );
  });

  it("leaves other values alone", () => {
    expect(neutraliseCsvFormula("Freezer -80")).toBe("Freezer -80");
  });

  it("keeps a plain signed measurement when asked, never = or @", () => {
    const keep = { keepSignedText: true };
    expect(neutraliseCsvFormula("-20C Freezer", keep)).toBe("-20C Freezer");
    expect(neutraliseCsvFormula("+5V PSU", keep)).toBe("+5V PSU");
    expect(neutraliseCsvFormula("-1+cmd|' /C calc'!A0", keep)).toBe(
      "'-1+cmd|' /C calc'!A0"
    );
    expect(neutraliseCsvFormula("-2*3", keep)).toBe("'-2*3");
    expect(neutraliseCsvFormula("=1", keep)).toBe("'=1");
    expect(neutraliseCsvFormula("@HQ", keep)).toBe("'@HQ");
  });
});

describe("encodeCsvListCell", () => {
  it("leaves a plain list alone", () => {
    expect(encodeCsvListCell(["ABC123", "DEF456"])).toBe("ABC123,DEF456");
  });

  it("quotes an item containing the separator", () => {
    expect(encodeCsvListCell(["Berlin, DE", "Munich"])).toBe(
      '"Berlin, DE",Munich'
    );
  });

  it("doubles quotes inside an item", () => {
    expect(encodeCsvListCell(['He said "hi"'])).toBe('"He said ""hi"""');
  });

  it("does not quote for edge whitespace, which the reader trims away", () => {
    expect(encodeCsvListCell([" padded "])).toBe(" padded ");
  });
});

describe("decodeCsvListCell", () => {
  it("splits a plain list and trims each item", () => {
    expect(decodeCsvListCell("ABC123, DEF456 , GHI789")).toEqual([
      "ABC123",
      "DEF456",
      "GHI789",
    ]);
  });

  it("drops empty items", () => {
    expect(decodeCsvListCell("")).toEqual([]);
    expect(decodeCsvListCell("a,,b,")).toEqual(["a", "b"]);
  });

  it("keeps a quoted item's separator", () => {
    expect(decodeCsvListCell('"Berlin, DE",Munich')).toEqual([
      "Berlin, DE",
      "Munich",
    ]);
  });

  it("trims a quoted item's edge whitespace too", () => {
    // Every consumer stores trimmed names, so an item never carries edge
    // whitespace into the database; a reader that kept it would look the name
    // up under a key nothing was stored under.
    expect(decodeCsvListCell('" padded ",plain')).toEqual(["padded", "plain"]);
  });

  it("reads a value that itself starts with a quote, written as a quoted item", () => {
    // Both halves of the leading-quote rule. A quoted item is the only way to
    // express a value that starts with a quote, so a bare `"ABCD"` is the
    // quoting, not the value.
    expect(decodeCsvListCell('"""ABCD"""')).toEqual(['"ABCD"']);
    expect(decodeCsvListCell('"ABCD"')).toEqual(["ABCD"]);
  });

  it("treats a quote inside an unquoted item as a literal", () => {
    expect(decodeCsvListCell('27" monitor,plain')).toEqual([
      '27" monitor',
      "plain",
    ]);
  });
});

describe("round trip", () => {
  it.each([
    [["ABC123", "DEF456"]],
    [["SN-2024,001"]],
    [["Berlin, DE", "Munich", "Wien"]],
    [['He said "hi"', "plain"]],
    [["https://maps.example.com?loc=40.7,-74.0"]],
  ])("survives %j", (values) => {
    expect(decodeCsvListCell(encodeCsvListCell(values))).toEqual(values);
  });
});
