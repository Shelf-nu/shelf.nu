/**
 * Unit tests for the asset-value helpers.
 *
 * These guard the contract that every "total value" surface relies on:
 * `valuation × quantity` for QT assets, plain `valuation` for INDIVIDUAL
 * (which always has quantity=1). If the math here drifts from the raw-SQL
 * `SUM(valuation * quantity)` expressions used in reports/aggregates,
 * surfaces will silently disagree on the same number.
 *
 * @see {@link file://./asset-value.ts}
 */
import { AssetType, type Currency } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  formatAssetValueWithBreakdown,
  getAssetTotalValue,
} from "./asset-value";

/** Shorthand for a workspace-currency fixture mirroring currency.test.ts. */
const usd = { currency: "USD" as Currency, locale: "en-US" };

describe("getAssetTotalValue", () => {
  it("returns the per-unit valuation for INDIVIDUAL assets", () => {
    // Individual assets are always quantity=1 (DB CHECK); total === valuation.
    expect(
      getAssetTotalValue({
        type: AssetType.INDIVIDUAL,
        valuation: 2000,
        quantity: 1,
      })
    ).toBe(2000);
  });

  it("returns valuation × quantity for QT assets with quantity > 1", () => {
    expect(
      getAssetTotalValue({
        type: AssetType.QUANTITY_TRACKED,
        valuation: 1,
        quantity: 100,
      })
    ).toBe(100);
  });

  it("returns 0 when valuation is null (no price set means no contribution)", () => {
    expect(
      getAssetTotalValue({
        type: AssetType.QUANTITY_TRACKED,
        valuation: null,
        quantity: 100,
      })
    ).toBe(0);
  });

  it("treats null/undefined quantity as 1 so callers omitting it don't explode", () => {
    expect(
      getAssetTotalValue({
        type: AssetType.INDIVIDUAL,
        valuation: 50,
        quantity: null,
      })
    ).toBe(50);
    expect(
      getAssetTotalValue({
        type: AssetType.INDIVIDUAL,
        valuation: 50,
      })
    ).toBe(50);
  });

  it("returns 0 when valuation is 0 and quantity > 0 (free × N is still 0)", () => {
    expect(
      getAssetTotalValue({
        type: AssetType.QUANTITY_TRACKED,
        valuation: 0,
        quantity: 100,
      })
    ).toBe(0);
  });
});

describe("formatAssetValueWithBreakdown", () => {
  it("INDIVIDUAL assets get only total — no redundant '× 1 unit' breakdown", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.INDIVIDUAL,
        valuation: 2000,
        quantity: 1,
      },
      usd
    );
    expect(result.total).toBe("$2,000.00");
    expect(result.unit).toBeNull();
    expect(result.suffix).toBeNull();
  });

  it("QT with quantity > 1 returns total, unit price, and labelled suffix", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.QUANTITY_TRACKED,
        valuation: 1,
        quantity: 100,
        unitOfMeasure: "boxes",
      },
      usd
    );
    expect(result.total).toBe("$100.00");
    expect(result.unit).toBe("$1.00");
    expect(result.suffix).toBe("× 100 boxes");
  });

  it("QT with quantity > 1 and no unitOfMeasure falls back to '× N units'", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.QUANTITY_TRACKED,
        valuation: 5,
        quantity: 20,
        unitOfMeasure: null,
      },
      usd
    );
    expect(result.total).toBe("$100.00");
    expect(result.unit).toBe("$5.00");
    expect(result.suffix).toBe("× 20 units");
  });

  it("QT with quantity == 1 omits breakdown (nothing useful to surface)", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.QUANTITY_TRACKED,
        valuation: 50,
        quantity: 1,
        unitOfMeasure: "boxes",
      },
      usd
    );
    expect(result.total).toBe("$50.00");
    expect(result.unit).toBeNull();
    expect(result.suffix).toBeNull();
  });

  it("QT with null valuation produces zero-formatted total and no breakdown", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.QUANTITY_TRACKED,
        valuation: null,
        quantity: 100,
        unitOfMeasure: "boxes",
      },
      usd
    );
    expect(result.total).toBe("$0.00");
    expect(result.unit).toBeNull();
    expect(result.suffix).toBeNull();
  });

  it("respects locale + currency formatting (de-DE, EUR)", () => {
    const result = formatAssetValueWithBreakdown(
      {
        type: AssetType.QUANTITY_TRACKED,
        valuation: 1.5,
        quantity: 10,
        unitOfMeasure: "kg",
      },
      { currency: "EUR" as Currency, locale: "de-DE" }
    );
    // German locale uses comma as decimal separator.
    expect(result.total).toContain("15,00");
    expect(result.unit).toContain("1,50");
    expect(result.suffix).toBe("× 10 kg");
  });
});
