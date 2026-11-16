/**
 * Tests for the bulk "Set min quantity" input rules, shared by the dialog and
 * the route that saves it.
 *
 * @see {@link file://./bulk-set-reorder-point-dialog.tsx}
 */
import { describe, expect, it } from "vitest";

import { BulkSetReorderPointSchema } from "./bulk-set-reorder-point-dialog";

function parse(minQuantity: string) {
  return BulkSetReorderPointSchema.safeParse({
    assetIds: ["asset-1"],
    minQuantity,
  });
}

describe("BulkSetReorderPointSchema", () => {
  it("accepts a whole number, zero included", () => {
    expect(parse("5")).toMatchObject({
      success: true,
      data: { minQuantity: 5 },
    });
    expect(parse("0")).toMatchObject({
      success: true,
      data: { minQuantity: 0 },
    });
  });

  it("clears the min quantity on an empty value", () => {
    expect(parse("  ")).toMatchObject({
      success: true,
      data: { minQuantity: null },
    });
  });

  it("rejects decimals and negative numbers", () => {
    expect(parse("1.5").success).toBe(false);
    expect(parse("-1").success).toBe(false);
  });

  it("rejects a number too large to store", () => {
    expect(parse("2147483647").success).toBe(true);
    expect(parse("2147483648").success).toBe(false);
  });
});
