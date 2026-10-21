import { describe, expect, it } from "vitest";
import { isLowStockFilterOn, toggleLowStockParam } from "./low-stock-param";

describe("toggleLowStockParam", () => {
  it("turns the filter on and restarts paging, keeping other filters", () => {
    const params = toggleLowStockParam(
      new URLSearchParams("category=c1&page=3")
    );

    expect(params.toString()).toBe("category=c1&lowStockOnly=true");
    expect(isLowStockFilterOn(params)).toBe(true);
  });

  it("turns the filter off and restarts paging", () => {
    const params = toggleLowStockParam(
      new URLSearchParams("lowStockOnly=true&page=2&tag=t1")
    );

    expect(params.toString()).toBe("tag=t1");
    expect(isLowStockFilterOn(params)).toBe(false);
  });

  it("treats any value other than true as off", () => {
    expect(isLowStockFilterOn(new URLSearchParams("lowStockOnly=1"))).toBe(
      false
    );
    expect(
      toggleLowStockParam(new URLSearchParams("lowStockOnly=1")).toString()
    ).toBe("lowStockOnly=true");
  });
});
