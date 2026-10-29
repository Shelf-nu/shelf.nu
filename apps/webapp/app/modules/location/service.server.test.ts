import { describe, expect, it, beforeEach, vi } from "vitest";

// why: testing location valuation aggregation logic without database
// dependency. The total is SUM(value × units placed here), which Prisma's
// `aggregate({_sum})` cannot express, so the implementation uses `$queryRaw`
// and the mock surface mirrors that. (Column is `value`, not `valuation`:
// `Asset.valuation` is `@map("value")` in schema.prisma.)
vi.mock("~/database/db.server", () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}));

const { db } = await import("~/database/db.server");
const { getLocationTotalValuation } = await import("./service.server");

const queryRawMock = vi.mocked(db.$queryRaw);

describe("getLocationTotalValuation", () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it("returns the QT-aware total (SUM(value × quantity)) for the location", async () => {
    // Postgres returns `double precision` for SUM(float * int) — arrives as
    // a JS number now that the implementation no longer casts to ::bigint
    // (the cast truncated fractional valuations).
    queryRawMock.mockResolvedValue([{ total: 1234 }]);

    const total = await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(total).toBe(1234);
  });

  it("preserves fractional totals (no ::bigint truncation)", async () => {
    // Prior bigint cast lost the .50; verifies we kept the float through.
    queryRawMock.mockResolvedValue([{ total: 99.5 }]);

    const total = await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    expect(total).toBe(99.5);
  });

  it("returns 0 when no valuation data is available", async () => {
    // COALESCE in the SQL yields 0 for empty/all-null sums.
    queryRawMock.mockResolvedValue([{ total: 0 }]);

    const total = await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    expect(total).toBe(0);
  });

  it("leaves archived assets out of the value stored at the location", async () => {
    queryRawMock.mockResolvedValue([{ total: 10 }]);

    await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    // `Prisma.sql` is a template object; its joined strings are the SQL text.
    const sql = (
      queryRawMock.mock.calls[0][0] as { strings: string[] }
    ).strings.join("?");
    expect(sql).toContain('a."archivedAt" IS NULL');
  });

  it("values only the units placed at this location, capped at the stock", async () => {
    queryRawMock.mockResolvedValue([{ total: 490 }]);

    await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    const sql = (
      queryRawMock.mock.calls[0][0] as { strings: string[] }
    ).strings.join("?");
    // A pool of 14 with 10 here and 4 elsewhere is worth 10 units here, and
    // a manual row plus a kit slice at this location never exceed the stock.
    expect(sql).toContain('SUM(al."quantity")');
    expect(sql).toContain('GROUP BY al."assetId"');
    expect(sql).toContain("LEAST(COALESCE(a.quantity, 1), placed.units)");
    expect(sql).toMatch(/WHERE al\."locationId" = \?/);
  });

  it("scopes the placements to the caller's workspace", async () => {
    queryRawMock.mockResolvedValue([{ total: 0 }]);

    await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    const query = queryRawMock.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(query.strings.join("?")).toContain('al."organizationId" = ?');
    expect(query.values).toEqual(["loc-123", "org-1"]);
  });

  it("returns 0 when the raw query returns no rows", async () => {
    queryRawMock.mockResolvedValue([]);

    const total = await getLocationTotalValuation({
      locationId: "loc-123",
      organizationId: "org-1",
    });

    expect(total).toBe(0);
  });
});
