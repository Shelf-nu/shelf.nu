/**
 * Advanced filters on numeric fields whose value holds no number.
 *
 * A numeric filter is compared in SQL against the column cast to a float. An
 * empty or unreadable value reaches that comparison as `NaN`, or — for the
 * standard numeric columns, which go through `Number()` — as `0`, silently
 * filtering for zero. Neither is a filter the user asked for, so the parser
 * drops it, the same way it drops a parameter with no value at all.
 *
 * @see {@link file://./filter-parsing.ts}
 */
import { CustomFieldType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { parseFilters } from "./filter-parsing";
import type { Column } from "../asset-index-settings/helpers";

// @vitest-environment node

const COLUMNS: Column[] = [
  { name: "valuation" as Column["name"], visible: true, position: 0 },
  {
    name: "cf_Weight" as Column["name"],
    visible: true,
    position: 1,
    cfType: CustomFieldType.NUMBER,
  },
  {
    name: "cf_Notes" as Column["name"],
    visible: true,
    position: 2,
    cfType: CustomFieldType.TEXT,
  },
];

const parse = (query: string) => parseFilters(query, COLUMNS);

describe("numeric advanced filters", () => {
  it.each([
    { label: "an empty standard value", query: "valuation=is:" },
    { label: "an unreadable standard value", query: "valuation=gt:abc" },
    { label: "an empty custom-field value", query: "cf_Weight=is:" },
    { label: "an unreadable custom-field value", query: "cf_Weight=lte:heavy" },
    { label: "a range with an empty bound", query: "cf_Weight=between:,100" },
    { label: "a range with one bound", query: "valuation=between:10" },
  ])("drops $label", ({ query }) => {
    expect(parse(query)).toEqual([]);
  });

  it("keeps a zero, which is a real number", () => {
    const [filter] = parse("valuation=is:0");
    expect(filter).toMatchObject({ name: "value", operator: "is", value: 0 });
  });

  it("keeps a readable custom-field range", () => {
    const [filter] = parse("cf_Weight=between:1.5,20");
    expect(filter).toMatchObject({
      name: "cf_Weight",
      operator: "between",
      value: ["1.5", "20"],
    });
  });

  it("leaves an empty value on a text custom field alone", () => {
    // Only numeric filters need a number; an empty text match is a separate
    // question and is not changed here.
    expect(parse("cf_Notes=is:")).toHaveLength(1);
  });
});
