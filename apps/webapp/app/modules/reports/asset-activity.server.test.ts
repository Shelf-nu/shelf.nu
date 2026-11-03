/**
 * Asset Activity Summary: readable rows and the full export.
 *
 * Pins what a reader sees for change events whose values are record ids
 * (location, category, asset model): names instead of ids, a sentence for
 * changes with only one side, a fallback for deleted records, and one
 * workspace-scoped lookup per record type. Also pins that the CSV export reads
 * every event in the timeframe rather than stopping at one page.
 *
 * @see {@link file://./helpers.server.ts}
 * @see {@link file://./asset-activity-description.server.ts}
 */

import type { ActivityAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the report reads Prisma; these cases hand it events and records
// in memory and assert on what it builds from them.
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    asset: { findMany: vi.fn(), findFirst: vi.fn() },
    location: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    assetModel: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";

import { assetActivityExportRows, assetActivityReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const ORG = "org-1";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-10-31T23:59:59Z"),
};

let eventSeq = 0;

/** An ActivityEvent row as `db.activityEvent.findMany` returns it. */
function event(
  action: ActivityAction,
  change: { field?: string; fromValue?: unknown; toValue?: unknown } = {}
) {
  eventSeq += 1;
  return {
    id: `evt-${eventSeq}`,
    organizationId: ORG,
    occurredAt: new Date("2026-10-15T10:00:00Z"),
    action,
    assetId: "asset-1",
    actorSnapshot: { firstName: "Sam", lastName: "Mover", displayName: null },
    field: change.field ?? null,
    fromValue: change.fromValue ?? null,
    toValue: change.toValue ?? null,
  };
}

const location = (fromValue: string | null, toValue: string | null) =>
  event("ASSET_LOCATION_CHANGED", { field: "locationId", fromValue, toValue });

beforeEach(() => {
  vi.clearAllMocks();
  eventSeq = 0;
  vi.mocked(db.activityEvent.count).mockResolvedValue(0);
  vi.mocked(db.activityEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([
    {
      id: "asset-1",
      organizationId: ORG,
      title: "Pallet 17",
      sequentialId: "SAM-0017",
      qrCodes: [{ id: "qr-17" }],
      mainImage: null,
      mainImageExpiration: null,
      thumbnailImage: null,
      assetModel: null,
    },
  ] as never);
  vi.mocked(db.location.findMany).mockResolvedValue([
    { id: "loc-leeds", name: "Leeds unit" },
    { id: "loc-hull", name: "Hull depot" },
  ] as never);
  vi.mocked(db.category.findMany).mockResolvedValue([
    { id: "cat-food", name: "Food parcels" },
  ] as never);
  vi.mocked(db.assetModel.findMany).mockResolvedValue([
    { id: "model-euro", name: "Euro pallet" },
  ] as never);
});

describe("assetActivityReport descriptions", () => {
  it("names the records a change points at, on either or both sides", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      location("loc-leeds", "loc-hull"),
      location(null, "loc-leeds"),
      location("loc-hull", null),
      location("loc-closed", "loc-hull"),
      event("ASSET_CATEGORY_CHANGED", {
        field: "categoryId",
        toValue: "cat-food",
      }),
      event("ASSET_MODEL_CHANGED", {
        field: "assetModelId",
        fromValue: "model-euro",
      }),
      event("ASSET_VALUATION_CHANGED", { field: "valuation", toValue: 1200 }),
      event("ASSET_NAME_CHANGED", {
        field: "name",
        fromValue: "Pallet",
        toValue: "Pallet 17",
      }),
      event("ASSET_CREATED"),
    ] as never);

    const { rows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    expect(rows.map((r) => r.description)).toEqual([
      "Location changed: Leeds unit → Hull depot",
      "Location set to Leeds unit",
      "Location removed, was Hull depot",
      "Location changed: (deleted location) → Hull depot",
      "Category set to Food parcels",
      "Asset model removed, was Euro pallet",
      "Valuation set to 1,200",
      "Name changed: Pallet → Pallet 17",
      "Asset created",
    ]);
  });

  it("reads each record type once per page, scoped to the workspace", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      location("loc-leeds", "loc-hull"),
      location("loc-hull", "loc-leeds"),
      location(null, "loc-hull"),
    ] as never);

    await assetActivityReport({ organizationId: ORG, timeframe: TIMEFRAME });

    expect(db.location.findMany).toHaveBeenCalledTimes(1);
    expect(db.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["loc-leeds", "loc-hull"] }, organizationId: ORG },
      select: { id: true, name: true },
    });
    // Nothing on the page points at a category or a model.
    expect(db.category.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
  });
});

describe("assetActivityExportRows", () => {
  it("writes references and both sides of each change", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      location("loc-leeds", "loc-hull"),
      event("ASSET_CREATED"),
    ] as never);

    const rows = await assetActivityExportRows({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        occurredAt: new Date("2026-10-15T10:00:00Z"),
        assetId: "asset-1",
        samId: "SAM-0017",
        qrId: "qr-17",
        assetName: "Pallet 17",
        activityType: "LOCATION_CHANGED",
        description: "Location changed: Leeds unit → Hull depot",
        changedFrom: "Leeds unit",
        changedTo: "Hull depot",
        performedBy: "Sam Mover",
      }),
      expect.objectContaining({
        occurredAt: new Date("2026-10-15T10:00:00Z"),
        assetId: "asset-1",
        samId: "SAM-0017",
        qrId: "qr-17",
        assetName: "Pallet 17",
        activityType: "CREATED",
        description: "Asset created",
        changedFrom: null,
        changedTo: null,
        performedBy: "Sam Mover",
      }),
    ]);
  });

  it("keeps reading past one batch until the timeframe is exhausted", async () => {
    const fullBatch = Array.from({ length: 5000 }, () =>
      location("loc-leeds", "loc-hull")
    );
    vi.mocked(db.activityEvent.findMany)
      .mockResolvedValueOnce(fullBatch as never)
      .mockResolvedValueOnce([location("loc-hull", "loc-leeds")] as never);

    const rows = await assetActivityExportRows({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    expect(rows).toHaveLength(5001);
    expect(rows[5000].description).toBe(
      "Location changed: Hull depot → Leeds unit"
    );
    const pages = vi
      .mocked(db.activityEvent.findMany)
      .mock.calls.map(([args]) => ({ skip: args?.skip, take: args?.take }));
    expect(pages).toEqual([
      { skip: 0, take: 5000 },
      { skip: 5000, take: 5000 },
    ]);
  });
});
