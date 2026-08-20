/**
 * Test suite for the shared simple-mode asset search helpers in search.server.
 *
 * Pins `splitAssetSearchTerms` (comma-splitting + the term-count cap), which is
 * consumed by the web `getAssets` fetcher, the mobile assets endpoint, and the
 * advanced-index `generateWhereClause` — a change here shifts search parsing on
 * every surface at once. Pure module — no mocks needed.
 *
 * @see {@link file://./search.server.ts}
 */
import { splitAssetSearchTerms } from "./search.server";

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
