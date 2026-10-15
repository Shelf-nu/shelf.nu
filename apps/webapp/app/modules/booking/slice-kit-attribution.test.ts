import { AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { resolveSliceKitIds } from "./slice-kit-attribution";

const noMemberships = new Map<string, string>();

describe("resolveSliceKitIds", () => {
  it("names the kit a kit-driven slice was booked under", () => {
    const kits = resolveSliceKitIds(
      {
        assetKitId: "ak-1",
        sourceKitId: null,
        assetKits: [{ kitId: "kit-1" }, { kitId: "kit-2" }],
        assetType: AssetType.QUANTITY_TRACKED,
      },
      new Map([["ak-1", "kit-1"]])
    );

    expect([...kits]).toEqual(["kit-1"]);
  });

  it("prefers sourceKitId, which outlives the membership row", () => {
    const kits = resolveSliceKitIds(
      {
        assetKitId: null,
        sourceKitId: "kit-1",
        assetKits: [],
        assetType: AssetType.INDIVIDUAL,
      },
      noMemberships
    );

    expect([...kits]).toEqual(["kit-1"]);
  });

  it("holds every kit of a standalone INDIVIDUAL member", () => {
    const kits = resolveSliceKitIds(
      {
        assetKitId: null,
        sourceKitId: null,
        assetKits: [{ kitId: "kit-1" }],
        assetType: AssetType.INDIVIDUAL,
      },
      noMemberships
    );

    expect([...kits]).toEqual(["kit-1"]);
  });

  it("holds no kit for a standalone QUANTITY_TRACKED slice", () => {
    const kits = resolveSliceKitIds(
      {
        assetKitId: null,
        sourceKitId: null,
        assetKits: [{ kitId: "kit-1" }],
        assetType: AssetType.QUANTITY_TRACKED,
      },
      noMemberships
    );

    expect(kits.size).toBe(0);
  });

  it("holds no kit for a membership the caller did not ask about", () => {
    const kits = resolveSliceKitIds(
      {
        assetKitId: "ak-other",
        sourceKitId: null,
        assetKits: [{ kitId: "kit-other" }],
        assetType: AssetType.INDIVIDUAL,
      },
      new Map([["ak-1", "kit-1"]])
    );

    expect(kits.size).toBe(0);
  });
});
