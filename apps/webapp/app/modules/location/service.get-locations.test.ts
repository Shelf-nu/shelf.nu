import { describe, expect, it, beforeEach, vi } from "vitest";

// why: exercising getLocations query-building (where/orderBy) without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    location: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

const { db } = await import("~/database/db.server");
const { getLocations } = await import("./service.server");

const findManyMock = vi.mocked(db.location.findMany);
const countMock = vi.mocked(db.location.count);

const organizationId = "org-1";

describe("getLocations", () => {
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    countMock.mockReset().mockResolvedValue(0);
  });

  it("defaults to sorting by createdAt descending", async () => {
    await getLocations({ organizationId });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });

  it("sorts by name ascending when requested", async () => {
    await getLocations({
      organizationId,
      orderBy: "name",
      orderDirection: "asc",
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } })
    );
  });

  it("sorts by asset count using the relation _count shape", async () => {
    await getLocations({
      organizationId,
      orderBy: "assets",
      orderDirection: "desc",
    });

    // Post-pivot: asset placement lives on the `AssetLocation` pivot, so the
    // _count-driven sort goes through `assetLocations` (was `assets`).
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { assetLocations: { _count: "desc" } },
      })
    );
  });

  it("falls back to createdAt for an unknown orderBy value", async () => {
    await getLocations({
      organizationId,
      orderBy: "maliciousField",
      orderDirection: "asc",
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } })
    );
  });

  it("falls back to createdAt for a prototype-chain key like 'toString'", async () => {
    await getLocations({
      organizationId,
      orderBy: "toString",
      orderDirection: "asc",
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } })
    );
  });

  it("normalizes an invalid orderDirection to desc", async () => {
    await getLocations({
      organizationId,
      orderBy: "name",
      // @ts-expect-error - simulating a malformed URL-supplied direction
      orderDirection: "sideways",
    });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: "desc" } })
    );
  });

  it("searches across name, description, and address (case-insensitive)", async () => {
    await getLocations({ organizationId, search: "warehouse" });

    const call = findManyMock.mock.calls[0]?.[0];
    expect(call?.where).toEqual({
      organizationId,
      OR: [
        { name: { contains: "warehouse", mode: "insensitive" } },
        { description: { contains: "warehouse", mode: "insensitive" } },
        { address: { contains: "warehouse", mode: "insensitive" } },
      ],
    });
  });

  it("does not add an OR clause when there is no search", async () => {
    await getLocations({ organizationId });

    const call = findManyMock.mock.calls[0]?.[0];
    expect(call?.where).toEqual({ organizationId });
  });
});
