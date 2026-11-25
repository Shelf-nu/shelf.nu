/**
 * Tests for {@link getSourceEditorData}: which slices get a From section,
 * and the per-source figures it carries.
 *
 * @see {@link file://./source-editor.server.ts}
 */

import type { SourceFree } from "@shelf/quantity-control";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeFreeBySourceForPools } from "./capacity.server";
import {
  getSourceEditorData,
  type SourceEditorSlice,
} from "./source-editor.server";

const dbMocks = vi.hoisted(() => ({
  sourceFindMany: vi.fn(),
  locationFindMany: vi.fn(),
}));

// why: the reader issues two plain reads besides the capacity reader; the
// rows they return are what each case varies.
vi.mock("~/database/db.server", () => ({
  db: {
    bookingAssetSource: { findMany: dbMocks.sourceFindMany },
    location: { findMany: dbMocks.locationFindMany },
  },
}));

// why: the free-per-source math has its own suite (capacity.server.test.ts);
// here only what the editor does with its result matters.
vi.mock("./capacity.server", () => ({
  computeFreeBySourceForPools: vi.fn(),
}));

const freeMock = vi.mocked(computeFreeBySourceForPools);

const FROM = new Date("2026-12-01T09:00:00.000Z");
const TO = new Date("2026-12-03T17:00:00.000Z");

function slice(overrides: Partial<SourceEditorSlice> = {}): SourceEditorSlice {
  return {
    id: "ba-1",
    assetId: "asset-1",
    sourceKitId: null,
    sourceAllocation: "AUTO",
    isPool: true,
    booking: { status: "RESERVED", from: FROM, to: TO },
    ...overrides,
  };
}

/** Unplaced first, then placements in creation order, as the reader returns. */
const FREE: SourceFree[] = [
  { kind: "UNPLACED", locationId: null, free: 9, createdOrder: -1 },
  { kind: "LOCATION", locationId: "loc-b", free: 4, createdOrder: 0 },
  { kind: "LOCATION", locationId: "loc-a", free: 10, createdOrder: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  freeMock.mockResolvedValue(new Map([["asset-1", FREE]]));
  dbMocks.locationFindMany.mockResolvedValue([
    { id: "loc-a", name: "Annex" },
    { id: "loc-b", name: "Basement" },
  ]);
  dbMocks.sourceFindMany.mockResolvedValue([
    {
      kind: "LOCATION",
      locationId: "loc-a",
      quantity: 8,
      outQuantity: 0,
      releasedQuantity: 0,
    },
    {
      kind: "UNPLACED",
      locationId: null,
      quantity: 7,
      outQuantity: 0,
      releasedQuantity: 0,
    },
  ]);
});

describe("getSourceEditorData", () => {
  it("lists every placement by name, then Unplaced, with free units", async () => {
    const editor = await getSourceEditorData({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: slice(),
    });

    expect(editor).toEqual({
      sliceId: "ba-1",
      mode: "AUTO",
      rows: [
        {
          key: "LOCATION:loc-a",
          locationId: "loc-a",
          label: "Annex",
          pending: 8,
          out: 0,
          free: 10,
        },
        {
          key: "LOCATION:loc-b",
          locationId: "loc-b",
          label: "Basement",
          pending: 0,
          out: 0,
          free: 4,
        },
        {
          key: "UNPLACED:",
          locationId: null,
          label: "Unplaced",
          pending: 7,
          out: 0,
          free: 9,
        },
      ],
      unassignedPending: 0,
      unknownOut: 0,
      stranded: [],
    });
    expect(freeMock).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      assetIds: ["asset-1"],
      window: { from: FROM, to: TO },
      excludeBookingId: "booking-1",
    });
    expect(dbMocks.sourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", bookingAssetId: "ba-1" },
      })
    );
  });

  it("splits out from pending and keeps Needs a location and unknown origins apart", async () => {
    dbMocks.sourceFindMany.mockResolvedValue([
      {
        kind: "LOCATION",
        locationId: "loc-a",
        quantity: 9,
        outQuantity: 2,
        releasedQuantity: 1,
      },
      {
        kind: "UNASSIGNED",
        locationId: null,
        quantity: 3,
        outQuantity: 0,
        releasedQuantity: 0,
      },
      {
        kind: "UNKNOWN",
        locationId: null,
        quantity: 1,
        outQuantity: 1,
        releasedQuantity: 0,
      },
    ]);

    const editor = await getSourceEditorData({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: slice({
        sourceAllocation: "MANUAL",
        booking: { status: "ONGOING", from: FROM, to: TO },
      }),
    });

    expect(editor?.mode).toBe("MANUAL");
    expect(editor?.rows[0]).toMatchObject({ pending: 6, out: 2 });
    expect(editor?.unassignedPending).toBe(3);
    expect(editor?.unknownOut).toBe(1);
  });

  it("lists units at a former placement apart, with its name", async () => {
    // loc-gone is no longer a placement but still has 2 out and 1 pending.
    dbMocks.sourceFindMany.mockResolvedValue([
      {
        kind: "LOCATION",
        locationId: "loc-gone",
        quantity: 3,
        outQuantity: 2,
        releasedQuantity: 0,
      },
      {
        kind: "UNPLACED",
        locationId: null,
        quantity: 7,
        outQuantity: 0,
        releasedQuantity: 0,
      },
    ]);
    dbMocks.locationFindMany.mockResolvedValue([
      { id: "loc-a", name: "Annex" },
      { id: "loc-b", name: "Basement" },
      { id: "loc-gone", name: "Old Shed" },
    ]);

    const editor = await getSourceEditorData({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: slice({ booking: { status: "ONGOING", from: FROM, to: TO } }),
    });

    expect(editor?.stranded).toEqual([
      {
        key: "LOCATION:loc-gone",
        locationId: "loc-gone",
        label: "Old Shed",
        pending: 1,
        out: 2,
      },
    ]);
    // Placements keep their rows; the former placement is not one of them.
    expect(editor?.rows.map((r) => r.locationId)).toEqual([
      "loc-a",
      "loc-b",
      null,
    ]);
    // One names read covers placements and the former placement.
    expect(dbMocks.locationFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["loc-b", "loc-a", "loc-gone"] },
        organizationId: "org-1",
      },
      select: { id: true, name: true },
    });
  });

  it("ignores a former placement with nothing left there", async () => {
    dbMocks.sourceFindMany.mockResolvedValue([
      {
        kind: "LOCATION",
        locationId: "loc-gone",
        quantity: 3,
        outQuantity: 0,
        releasedQuantity: 3,
      },
    ]);

    const editor = await getSourceEditorData({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: slice(),
    });

    expect(editor?.stranded).toEqual([]);
  });

  it("returns null for a pool without manual placements", async () => {
    freeMock.mockResolvedValue(new Map([["asset-1", [FREE[0]]]]));

    const editor = await getSourceEditorData({
      organizationId: "org-1",
      bookingId: "booking-1",
      slice: slice(),
    });

    expect(editor).toBeNull();
    expect(dbMocks.locationFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a LEGACY slice", { sourceAllocation: "LEGACY" }],
    ["a kit residue slice", { sourceKitId: "kit-1" }],
    ["an individual asset", { isPool: false }],
    [
      "a completed booking",
      { booking: { status: "COMPLETE", from: FROM, to: TO } },
    ],
  ] as Array<[string, Partial<SourceEditorSlice>]>)(
    "returns null without a query for %s",
    async (_name, overrides) => {
      const editor = await getSourceEditorData({
        organizationId: "org-1",
        bookingId: "booking-1",
        slice: slice(overrides),
      });

      expect(editor).toBeNull();
      expect(freeMock).not.toHaveBeenCalled();
      expect(dbMocks.sourceFindMany).not.toHaveBeenCalled();
    }
  );
});
