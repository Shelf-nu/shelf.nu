/**
 * Test suite for the shared simple-mode asset search helpers in search.server.
 *
 * Pins `splitAssetSearchTerms` (comma-splitting + the term-count cap) and
 * `assertAssetSearchIdCeiling` (the bind-param ceiling guard), both consumed by
 * the web `getAssets` fetcher and the mobile assets endpoint — a change here
 * shifts search behaviour on every id-materializing surface at once. Pure
 * module — no mocks needed.
 *
 * @see {@link file://./search.server.ts}
 */
import { ShelfError } from "~/utils/error";
import {
  MAX_MATCHED_ASSET_SEARCH_IDS,
  assertAssetSearchIdCeiling,
  splitAssetSearchTerms,
} from "./search.server";

// @vitest-environment node

describe("splitAssetSearchTerms", () => {
  it("lowercases, trims, splits on commas and drops empties", () => {
    expect(splitAssetSearchTerms("  Tripod, Canon EOS ,,")).toEqual([
      "tripod",
      "canon eos",
    ]);
  });

  it("returns an empty array for empty and whitespace-only input", () => {
    expect(splitAssetSearchTerms("")).toEqual([]);
    expect(splitAssetSearchTerms("   ")).toEqual([]);
    expect(splitAssetSearchTerms(" , , ")).toEqual([]);
  });

  it("caps the number of honored terms as a query-cost guard", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `term${i}`).join(",");
    expect(splitAssetSearchTerms(fifteen)).toHaveLength(10);
  });
});

describe("assertAssetSearchIdCeiling", () => {
  it("does not throw at or below the bind-param ceiling", () => {
    expect(() => assertAssetSearchIdCeiling(0)).not.toThrow();
    expect(() => assertAssetSearchIdCeiling(1)).not.toThrow();
    expect(() =>
      assertAssetSearchIdCeiling(MAX_MATCHED_ASSET_SEARCH_IDS)
    ).not.toThrow();
  });

  it("throws a user-input 400 above the ceiling (not a captured 500)", () => {
    let thrown: unknown;
    try {
      assertAssetSearchIdCeiling(MAX_MATCHED_ASSET_SEARCH_IDS + 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    // A 400 so the client sees a "refine your search" message, not "something
    // went wrong"; shouldBeCaptured false so an over-broad search never pages.
    expect((thrown as ShelfError).status).toBe(400);
    expect((thrown as ShelfError).shouldBeCaptured).toBe(false);
  });
});
