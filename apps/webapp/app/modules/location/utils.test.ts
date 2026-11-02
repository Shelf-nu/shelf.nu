import { describe, expect, it } from "vitest";
import { getUnitsAtLocation } from "./utils";

describe("getUnitsAtLocation", () => {
  it("returns the units of a single placement", () => {
    expect(getUnitsAtLocation({ stock: 143, placedQuantities: [99] })).toBe(99);
  });

  it("adds a manual row and a kit slice that fit within the stock", () => {
    expect(getUnitsAtLocation({ stock: 100, placedQuantities: [60, 30] })).toBe(
      90
    );
  });

  it("never holds more units than the stock", () => {
    // 100 placed by hand plus a 50-unit kit slice at the same location are
    // the same physical units.
    expect(
      getUnitsAtLocation({ stock: 100, placedQuantities: [100, 50] })
    ).toBe(100);
  });

  it("counts an INDIVIDUAL asset (no stock) as one unit", () => {
    expect(getUnitsAtLocation({ stock: null, placedQuantities: [1] })).toBe(1);
  });

  it("returns 0 when nothing is placed", () => {
    expect(getUnitsAtLocation({ stock: 10, placedQuantities: [] })).toBe(0);
  });
});
