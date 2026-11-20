/**
 * Names given to assets created from stock.
 *
 * @see {@link file://./create-from-stock.ts}
 */
import { describe, expect, it } from "vitest";
import { assetsFromStockMax, assetsFromStockTitles } from "./create-from-stock";

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

describe("assetsFromStockMax", () => {
  it("is the smallest of free units, the source's units left and the cap", () => {
    expect(assetsFromStockMax(7, 4)).toBe(4);
    expect(assetsFromStockMax(3, 5)).toBe(3);
    expect(assetsFromStockMax(40, 30)).toBe(25);
  });

  it("is zero when nothing is free or the source is empty", () => {
    expect(assetsFromStockMax(0, 5)).toBe(0);
    expect(assetsFromStockMax(5, 0)).toBe(0);
    expect(assetsFromStockMax(-2, 5)).toBe(0);
  });
});
