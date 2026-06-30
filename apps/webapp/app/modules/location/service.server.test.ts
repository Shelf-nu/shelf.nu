import { describe, expect, it, beforeEach, vi } from "vitest";

// why: testing location valuation aggregation logic without database
// dependency. QT-aware totals require SUM(value × quantity) which Prisma's
// `aggregate({_sum})` cannot express, so the implementation now uses
// `$queryRaw` — the mock surface mirrors that. (Column is `value`, not
// `valuation`: `Asset.valuation` is `@map("value")` in schema.prisma.)
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

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(total).toBe(1234);
  });

  it("preserves fractional totals (no ::bigint truncation)", async () => {
    // Prior bigint cast lost the .50; verifies we kept the float through.
    queryRawMock.mockResolvedValue([{ total: 99.5 }]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(99.5);
  });

  it("returns 0 when no valuation data is available", async () => {
    // COALESCE in the SQL yields 0 for empty/all-null sums.
    queryRawMock.mockResolvedValue([{ total: 0 }]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(0);
  });

  it("returns 0 when the raw query returns no rows", async () => {
    queryRawMock.mockResolvedValue([]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(0);
  });
});
