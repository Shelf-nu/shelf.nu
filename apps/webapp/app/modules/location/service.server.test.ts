import { describe, expect, it, beforeEach, vi } from "vitest";

// why: testing location valuation aggregation logic without database
// dependency. QT-aware totals require SUM(valuation × quantity) which Prisma's
// `aggregate({_sum})` cannot express, so the implementation now uses
// `$queryRaw` — the mock surface mirrors that.
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

  it("returns the QT-aware total (SUM(valuation × quantity)) for the location", async () => {
    // bigint is the SQL cast in the implementation; the helper Number()s it.
    queryRawMock.mockResolvedValue([{ total: BigInt(1234) }]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(total).toBe(1234);
  });

  it("returns 0 when no valuation data is available", async () => {
    // COALESCE in the SQL yields 0 for empty/all-null sums.
    queryRawMock.mockResolvedValue([{ total: BigInt(0) }]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(0);
  });

  it("returns 0 when the raw query returns no rows", async () => {
    queryRawMock.mockResolvedValue([]);

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(0);
  });
});
