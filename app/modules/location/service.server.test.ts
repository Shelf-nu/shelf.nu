import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      aggregate: vi.fn(),
    },
  },
}));

const { db } = await import("~/database/db.server");
const { getLocationTotalValuation } = await import("./service.server");

const aggregateMock = vi.mocked(db.asset.aggregate);

describe("getLocationTotalValuation", () => {
  beforeEach(() => {
    aggregateMock.mockReset();
  });

  it("returns the aggregated valuation for all assets in a location", async () => {
    aggregateMock.mockResolvedValue({ _sum: { valuation: 1234.56 } });

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(aggregateMock).toHaveBeenCalledWith({
      _sum: { valuation: true },
      where: { locationId: "loc-123" },
    });
    expect(total).toBe(1234.56);
  });

  it("returns 0 when no valuation data is available", async () => {
    aggregateMock.mockResolvedValue({ _sum: { valuation: null } });

    const total = await getLocationTotalValuation({ locationId: "loc-123" });

    expect(total).toBe(0);
  });
});
