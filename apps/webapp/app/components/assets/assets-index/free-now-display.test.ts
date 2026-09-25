/**
 * Tests for the `Free now` cell text.
 *
 * @see {@link file://./free-now-display.ts}
 */
import { describe, expect, it } from "vitest";

import { resolveFreeNowText } from "./free-now-display";

describe("resolveFreeNowText", () => {
  it("says what the free count is out of, with the unit", () => {
    expect(
      resolveFreeNowText({ available: 14, total: 20, unitOfMeasure: "pcs" })
    ).toBe("14 of 20 pcs");
  });

  it("leaves the unit out when the pool has none", () => {
    expect(
      resolveFreeNowText({ available: 14, total: 20, unitOfMeasure: null })
    ).toBe("14 of 20");
    expect(
      resolveFreeNowText({ available: 14, total: 20, unitOfMeasure: "  " })
    ).toBe("14 of 20");
  });

  it("shows the free count alone when the total is unknown", () => {
    expect(
      resolveFreeNowText({ available: 3, total: null, unitOfMeasure: "kg" })
    ).toBe("3");
  });

  it("reads 0 of a pool with nothing free", () => {
    expect(
      resolveFreeNowText({ available: 0, total: 5, unitOfMeasure: "rolls" })
    ).toBe("0 of 5 rolls");
  });
});
