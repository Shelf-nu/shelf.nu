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
