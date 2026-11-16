/**
 * Splitting an advanced-index `sortBy` URL parameter into its name, direction
 * and field type.
 *
 * The grammar is `name:direction[:fieldType]`, and a custom field NAME is free
 * text that may itself contain colons. Direction and type are read from the
 * end; everything before them belongs to the name.
 *
 * @see {@link file://./sort-param.ts}
 */
import { describe, expect, it } from "vitest";

import { splitSortParam } from "./sort-param";

describe("splitSortParam", () => {
  it.each([
    ["name", ["name", undefined, undefined]],
    ["name:desc", ["name", "desc", undefined]],
    ["cf_Weight (kg):asc:NUMBER", ["cf_Weight (kg)", "asc", "NUMBER"]],
    ["cf_Ratio: target:desc:NUMBER", ["cf_Ratio: target", "desc", "NUMBER"]],
    ["cf_Ratio: target:DESC", ["cf_Ratio: target", "DESC", undefined]],
    ["cf_a:b:c:asc:TEXT", ["cf_a:b:c", "asc", "TEXT"]],
  ])("splits %s", (raw, expected) => {
    expect(splitSortParam(raw)).toEqual(expected);
  });

  it("leaves an unknown direction for the caller to reject", () => {
    expect(splitSortParam("cf_x:bogus")).toEqual(["cf_x", "bogus", undefined]);
  });

  it("round-trips a colon name through the sort popover's serialization", () => {
    // The popover rebuilds each sort from the URL, may flip the direction,
    // and writes `[name, direction, cfType].join(":")` back.
    const [name, direction, cfType] = splitSortParam(
      "cf_Ratio: target:desc:NUMBER"
    );
    const flipped = direction === "asc" ? "desc" : "asc";
    const rewritten = [name, flipped, cfType].join(":");

    expect(rewritten).toBe("cf_Ratio: target:asc:NUMBER");
    expect(splitSortParam(rewritten)[0]).toBe("cf_Ratio: target");
  });
});
