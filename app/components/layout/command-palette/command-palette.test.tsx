import { describe, expect, it } from "vitest";

import {
  getAssetCommandValue,
  shouldApplyAssetResults,
  type AssetSearchResult,
} from "./command-palette";

describe("getAssetCommandValue", () => {
  const baseAsset: AssetSearchResult = {
    id: "asset-123",
    title: "4K Camera",
    sequentialId: "AS-100",
    mainImage: null,
    mainImageExpiration: null,
    locationName: "Studio",
  };

  it("includes the primary searchable fields", () => {
    const value = getAssetCommandValue(baseAsset);

    expect(value).toContain("asset-123");
    expect(value).toContain("4K Camera");
    expect(value).toContain("AS-100");
    expect(value).toContain("Studio");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const value = getAssetCommandValue({
      ...baseAsset,
      sequentialId: null,
      locationName: null,
    });

    expect(value).toContain("asset-123");
    expect(value).toContain("4K Camera");
    expect(value).not.toContain("null");
  });
});

describe("shouldApplyAssetResults", () => {
  const baseParams = {
    currentQuery: "cam",
    currentDebouncedQuery: "cam",
    latestRequestedQuery: "cam",
    responseQuery: "cam",
  };

  it("returns false when the input has been cleared", () => {
    expect(
      shouldApplyAssetResults({
        ...baseParams,
        currentQuery: "",
        currentDebouncedQuery: "",
      })
    ).toBe(false);
  });

  it("returns false for stale responses", () => {
    expect(
      shouldApplyAssetResults({
        ...baseParams,
        latestRequestedQuery: "camera",
        responseQuery: "cam",
      })
    ).toBe(false);
  });

  it("returns true for the latest matching response", () => {
    expect(shouldApplyAssetResults(baseParams)).toBe(true);
  });
});
