/**
 * Picking the add-on price for a billing interval.
 *
 * @see {@link file://./addon-price.ts}
 */
import { describe, expect, it } from "vitest";

import { resolveAddonPriceForInterval } from "./addon-price";

const MONTHLY = { id: "price_month", unit_amount: 500 };
const YEARLY = { id: "price_year", unit_amount: 5000 };

describe("resolveAddonPriceForInterval", () => {
  it("answers with the price for the chosen interval", () => {
    const prices = { month: MONTHLY, year: YEARLY };

    expect(resolveAddonPriceForInterval(prices, "month")).toBe(MONTHLY);
    expect(resolveAddonPriceForInterval(prices, "year")).toBe(YEARLY);
  });

  it("answers null rather than the other interval's price", () => {
    // The case this exists for: an amount from the wrong interval renders under
    // the selected interval's suffix and is submitted as the price to bill.
    expect(
      resolveAddonPriceForInterval({ month: null, year: YEARLY }, "month")
    ).toBeNull();

    expect(
      resolveAddonPriceForInterval({ month: MONTHLY, year: null }, "year")
    ).toBeNull();
  });

  it("answers null before an interval has been chosen", () => {
    expect(
      resolveAddonPriceForInterval({ month: MONTHLY, year: YEARLY }, null)
    ).toBeNull();
  });

  it("answers null when the add-on has no prices at all", () => {
    expect(
      resolveAddonPriceForInterval({ month: null, year: null }, "month")
    ).toBeNull();
  });
});
