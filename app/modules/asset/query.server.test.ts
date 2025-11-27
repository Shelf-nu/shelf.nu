import { describe, expect, it, vi } from "vitest";
import { locationDescendantsMock } from "@mocks/location-descendants";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

// eslint-disable-next-line import/first
import { parseSortingOptions } from "./query.server";

describe("parseSortingOptions", () => {
  it("allows sorting by updatedAt", () => {
    const { orderByClause } = parseSortingOptions(["updatedAt:desc"]);

    expect(orderByClause).toBe('ORDER BY "assetUpdatedAt" desc');
  });
});
