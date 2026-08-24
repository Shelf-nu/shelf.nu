/**
 * Test suite for the mobile assets-list search resolver.
 *
 * Pins the parity contract: mobile search runs the SAME shared org-scoped
 * UNION (`buildAssetSearchUnion`) the web `getAssets` fetcher uses — one
 * index-driven query instead of the old multi-table OR + narrow/fallback
 * dance. `db.$queryRaw` is mocked so we can assert the resolver threads the
 * UNION's id rows into the Prisma where-fragment, and that the fail-closed
 * behaviour (genuinely-empty vs whitespace-only search) is preserved exactly.
 *
 * @see {@link file://./mobile-asset-search.server.ts}
 * @see {@link file://./../asset/search-union.server.ts}
 */
import { db } from "~/database/db.server";
import { resolveMobileAssetSearchWhere } from "./mobile-asset-search.server";

// @vitest-environment node

// why: the UNION runs as a raw query; mock it to return a known id set so we
// can assert the resolver threads those ids into the Prisma where fragment
// without hitting a real database.
vi.mock("~/database/db.server", () => ({
  db: { $queryRaw: vi.fn() },
}));

describe("resolveMobileAssetSearchWhere", () => {
  const queryRawMock = vi.mocked(db.$queryRaw);

  beforeEach(() => {
    queryRawMock.mockReset().mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  });

  it("returns no filter and runs no UNION for a truly empty search", async () => {
    await expect(
      resolveMobileAssetSearchWhere({ organizationId: "o1", search: "" })
    ).resolves.toEqual({});
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("matches NOTHING for non-blank input that yields zero terms", async () => {
    // A typed space or bare comma in a debounced type-ahead must not flash
    // the full unfiltered list. `id: { in: [] }` is always false.
    for (const input of ["  , ", "   ", ","]) {
      queryRawMock.mockClear();
      await expect(
        resolveMobileAssetSearchWhere({ organizationId: "o1", search: input })
      ).resolves.toEqual({ id: { in: [] } });
      expect(queryRawMock).not.toHaveBeenCalled();
    }
  });

  it("resolves a real search to the id set the UNION returns", async () => {
    await expect(
      resolveMobileAssetSearchWhere({ organizationId: "o1", search: "tripod" })
    ).resolves.toEqual({ id: { in: ["a1", "a2"] } });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("returns an always-false id filter when the UNION finds no matches", async () => {
    queryRawMock.mockResolvedValue([]);
    await expect(
      resolveMobileAssetSearchWhere({ organizationId: "o1", search: "zzz" })
    ).resolves.toEqual({ id: { in: [] } });
  });

  it("normalizes terms the same way as web search (lowercase, comma-split)", async () => {
    // Structural pin only — the actual normalization lives in
    // splitAssetSearchTerms (search.server.ts) and is exercised there. This
    // just confirms the resolver still calls through to the UNION for
    // multi-term, mixed-case input rather than short-circuiting.
    await expect(
      resolveMobileAssetSearchWhere({
        organizationId: "o1",
        search: "  Tripod, Canon ",
      })
    ).resolves.toEqual({ id: { in: ["a1", "a2"] } });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("id-shaped searches now resolve via the same single UNION (superset, pre-approved)", async () => {
    // Previously ID-shaped terms took a narrow 5-column fast path with a
    // full-clause fallback on zero rows. The UNION always searches all 10
    // sources in one query, so an ID-shaped search now returns the (larger,
    // more correct) full result set directly — no second query.
    await expect(
      resolveMobileAssetSearchWhere({
        organizationId: "o1",
        search: "SAM-0001",
      })
    ).resolves.toEqual({ id: { in: ["a1", "a2"] } });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });
});
