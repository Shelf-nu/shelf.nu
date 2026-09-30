/**
 * Tests for {@link buildUnavailableAssets}.
 *
 * @see {@link file://./unavailable-assets.ts}
 */
import { describe, expect, it } from "vitest";

import { buildUnavailableAssets } from "./unavailable-assets";

function row(
  overrides: Partial<Parameters<typeof buildUnavailableAssets>[0][number]> = {}
) {
  return {
    id: "asset-1",
    title: "Barndoors",
    availableToBook: true,
    kit: null,
    ...overrides,
  };
}

describe("buildUnavailableAssets", () => {
  it("returns nothing when every asset is bookable", () => {
    expect(
      buildUnavailableAssets([
        row({ id: "asset-1" }),
        row({ id: "asset-2", kit: { name: "Camera Kit" } }),
      ])
    ).toEqual([]);
  });

  it("names a flagged asset and the kit it sits in", () => {
    const result = buildUnavailableAssets([
      row({ id: "asset-1", title: "Light", availableToBook: true }),
      row({
        id: "asset-2",
        title: "Barndoors",
        availableToBook: false,
        kit: { name: "Aputure 120d II Kit 02" },
      }),
    ]);

    expect(result).toEqual([
      {
        id: "asset-2",
        title: "Barndoors",
        kitName: "Aputure 120d II Kit 02",
      },
    ]);
  });

  it("reports no kit for an asset booked in its own right", () => {
    const result = buildUnavailableAssets([
      row({ id: "asset-1", title: "Tripod", availableToBook: false }),
    ]);

    expect(result).toEqual([{ id: "asset-1", title: "Tripod", kitName: null }]);
  });

  /**
   * A quantity-tracked asset can hold a standalone slice and a slice in each
   * of several kits, so it arrives once per slice. Listing it three times
   * would suggest three things to fix when there is one flag to clear.
   */
  it("names an asset once however many slices it holds", () => {
    const result = buildUnavailableAssets([
      row({ id: "asset-1", title: "Gel", availableToBook: false, kit: null }),
      row({
        id: "asset-1",
        title: "Gel",
        availableToBook: false,
        kit: { name: "Kit A" },
      }),
      row({
        id: "asset-1",
        title: "Gel",
        availableToBook: false,
        kit: { name: "Kit B" },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("asset-1");
  });

  it("keeps the order the rows arrive in", () => {
    const result = buildUnavailableAssets([
      row({ id: "asset-3", title: "Third", availableToBook: false }),
      row({ id: "asset-1", title: "First", availableToBook: false }),
      row({ id: "asset-2", title: "Second", availableToBook: false }),
    ]);

    expect(result.map((asset) => asset.title)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
  });
});
