/**
 * Names given to assets created from stock.
 *
 * @see {@link file://./create-from-stock.ts}
 */
import { describe, expect, it } from "vitest";
import { assetsFromStockTitles } from "./create-from-stock";

describe("assetsFromStockTitles", () => {
  it("keeps the typed name for one asset, trimmed", () => {
    expect(assetsFromStockTitles("  Drill  ", 1)).toEqual(["Drill"]);
  });

  it("numbers several assets from 1", () => {
    expect(assetsFromStockTitles("Drill", 3)).toEqual([
      "Drill 1",
      "Drill 2",
      "Drill 3",
    ]);
  });
});
