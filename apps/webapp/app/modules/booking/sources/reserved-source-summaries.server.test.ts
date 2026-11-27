/**
 * The source line each reserved booking of a pool shows in the asset
 * tooltip.
 *
 * @see {@link file://./reserved-source-summaries.server.ts}
 */

import { describe, expect, it, vi } from "vitest";

import type { ExtendedPrismaClient } from "~/database/db.server";

import { withReservedSourceSummaries } from "./reserved-source-summaries.server";

const ORG = "org-1";

/** A client whose three reads return the staged rows. */
function client({
  slices = [],
  rows = [],
  locations = [],
}: {
  slices?: Array<{ id: string; bookingId: string }>;
  rows?: Array<{
    bookingAssetId: string;
    kind: "LOCATION" | "UNPLACED" | "UNASSIGNED" | "UNKNOWN" | "KIT";
    locationId: string | null;
    quantity: number;
  }>;
  locations?: Array<{ id: string; name: string }>;
}) {
  return {
    bookingAsset: { findMany: vi.fn().mockResolvedValue(slices) },
    bookingAssetSource: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          rows.map((row) => ({ outQuantity: 0, releasedQuantity: 0, ...row }))
        ),
    },
    location: { findMany: vi.fn().mockResolvedValue(locations) },
  };
}

/** A tooltip row for booking `id` in `status`. */
function row(id: string, status: string, assetKitId: string | null = null) {
  return { quantity: 15, assetKitId, booking: { id, status } };
}

describe("withReservedSourceSummaries", () => {
  it("adds the planned sources to a reserved standalone row", async () => {
    const fake = client({
      slices: [{ id: "ba-1", bookingId: "b-1" }],
      rows: [
        {
          bookingAssetId: "ba-1",
          kind: "LOCATION",
          locationId: "loc-demo",
          quantity: 8,
        },
        {
          bookingAssetId: "ba-1",
          kind: "UNPLACED",
          locationId: null,
          quantity: 7,
        },
      ],
      locations: [{ id: "loc-demo", name: "Demo Warehouse" }],
    });

    const result = await withReservedSourceSummaries(
      fake as unknown as ExtendedPrismaClient,
      {
        organizationId: ORG,
        assetId: "cables",
        rows: [row("b-1", "RESERVED"), row("b-2", "ONGOING")],
      }
    );

    expect(
      result.map((r) => ("sourceSummary" in r ? r.sourceSummary : undefined))
    ).toEqual(["Demo Warehouse 8 · Unplaced 7", undefined]);
    expect(fake.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: "cables",
          bookingId: { in: ["b-1"] },
          assetKitId: null,
          booking: { organizationId: ORG, status: "RESERVED" },
        }),
      })
    );
    expect(fake.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc-demo"] }, organizationId: ORG },
      select: { id: true, name: true },
    });
  });

  it("reads nothing more than the probe while every group is LEGACY", async () => {
    const fake = client({});

    const rows = [row("b-1", "RESERVED")];
    const result = await withReservedSourceSummaries(
      fake as unknown as ExtendedPrismaClient,
      { organizationId: ORG, assetId: "cables", rows }
    );

    expect(result).toBe(rows);
    expect(fake.bookingAssetSource.findMany).not.toHaveBeenCalled();
    expect(fake.location.findMany).not.toHaveBeenCalled();
  });

  it("never describes a kit row", async () => {
    const fake = client({});

    await withReservedSourceSummaries(fake as unknown as ExtendedPrismaClient, {
      organizationId: ORG,
      assetId: "cables",
      rows: [row("b-1", "RESERVED", "ak-1")],
    });

    expect(fake.bookingAsset.findMany).not.toHaveBeenCalled();
  });
});
