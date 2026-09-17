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

import { decodeCsvListCell, encodeCsvListCell } from "./csv-cells";

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

  it("quotes an item whose edge whitespace must survive", () => {
    expect(encodeCsvListCell([" padded "])).toBe('" padded "');
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

  it("keeps a quoted item's edge whitespace", () => {
    expect(decodeCsvListCell('" padded ",plain')).toEqual([
      " padded ",
      "plain",
    ]);
  });

  it("reads a value that itself starts with a quote, written as a quoted item", () => {
    // Both halves of a deliberate trade-off, pinned so neither is "fixed"
    // back: a leading quote opens a quoted item, so a value starting with one
    // must be escaped, and a cell that was not escaped reads one char shorter.
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
    [[" padded "]],
  ])("survives %j", (values) => {
    expect(decodeCsvListCell(encodeCsvListCell(values))).toEqual(values);
  });
});
