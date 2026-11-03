/**
 * Asset Activity Summary: readable rows and the full export.
 *
 * Pins what a reader sees for change events whose values are record ids
 * (location, category, asset model, tags): names instead of ids, a sentence
 * for changes with only one side, a fallback for deleted records, and one
 * workspace-scoped lookup per record type. Also pins the export mode, which
 * reads every event in the timeframe in batches, counts the KPIs once, skips
 * thumbnail re-signing and stops at a stated ceiling.
 *
 * @see {@link file://./helpers.server.ts}
 * @see {@link file://./asset-activity-description.server.ts}
 */

import type { ActivityAction, Prisma } from "@prisma/client";
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
    tag: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// why: re-signing an image calls Supabase storage; these cases only check
// whether the report asks for it.
vi.mock("~/modules/asset/service.server", () => ({
  refreshExpiredAssetImages: vi.fn((assets: unknown[]) =>
    Promise.resolve(assets)
  ),
}));

import { db } from "~/database/db.server";
import { refreshExpiredAssetImages } from "~/modules/asset/service.server";

import { buildReportAssetFilter } from "./asset-filter";
import {
  ACTIVITY_EXPORT_MAX_ROWS,
  assetActivityReport,
} from "./helpers.server";
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
  change: {
    field?: string;
    fromValue?: unknown;
    toValue?: unknown;
    meta?: unknown;
  } = {}
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
    meta: change.meta ?? null,
  };
}

const location = (
  fromValue: string | null,
  toValue: string | null,
  meta?: unknown
) =>
  event("ASSET_LOCATION_CHANGED", {
    field: "locationId",
    fromValue,
    toValue,
    meta,
  });

/** Runs one page of the report over `events` and returns what each row says. */
async function readableRows(events: ReturnType<typeof event>[]) {
  vi.mocked(db.activityEvent.findMany).mockResolvedValue(events as never);
  const { rows } = await assetActivityReport({
    organizationId: ORG,
    timeframe: TIMEFRAME,
  });
  return rows.map(({ description, changedFrom, changedTo }) => ({
    description,
    changedFrom,
    changedTo,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  eventSeq = 0;
  vi.mocked(db.activityEvent.count).mockResolvedValue(0);
  vi.mocked(db.activityEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
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
  vi.mocked(db.tag.findMany).mockResolvedValue([
    { id: "tag-fragile", name: "Fragile" },
    { id: "tag-cold", name: "Keep cold" },
  ] as never);
});

describe("assetActivityReport descriptions", () => {
  it("names the records a location change points at, on either or both sides", async () => {
    expect(
      await readableRows([
        location("loc-leeds", "loc-hull"),
        location(null, "loc-leeds"),
        location("loc-hull", null),
        location("loc-closed", "loc-hull"),
      ])
    ).toEqual([
      {
        description: "Location changed: Leeds unit → Hull depot",
        changedFrom: "Leeds unit",
        changedTo: "Hull depot",
      },
      {
        description: "Location set to Leeds unit",
        changedFrom: null,
        changedTo: "Leeds unit",
      },
      {
        description: "Location removed, was Hull depot",
        changedFrom: "Hull depot",
        changedTo: null,
      },
      {
        description: "Location changed: (deleted location) → Hull depot",
        changedFrom: "(deleted location)",
        changedTo: "Hull depot",
      },
    ]);
  });

  it("counts units for quantity-tracked moves, including each half of a partial move", async () => {
    const descriptions = (
      await readableRows([
        location("loc-leeds", "loc-hull", { quantity: 12 }),
        location(null, "loc-leeds", { quantity: 1 }),
        location("loc-leeds", null, { quantity: 5, side: "from" }),
        location(null, "loc-hull", { quantity: 5, side: "to" }),
        location("loc-hull", null, { quantity: 3 }),
      ])
    ).map((row) => row.description);

    expect(descriptions).toEqual([
      "12 units moved: Leeds unit → Hull depot",
      "1 unit placed at Leeds unit",
      "5 units moved from Leeds unit",
      "5 units moved to Hull depot",
      "3 units removed from Hull depot",
    ]);
  });

  it("says placed, not moved, for units placed from unplaced stock, in the asset's unit", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      {
        id: "asset-1",
        organizationId: ORG,
        title: "Rice",
        unitOfMeasure: "kg",
        qrCodes: [],
      },
    ] as never);

    const descriptions = (
      await readableRows([
        location(null, "loc-hull", {
          quantity: 40,
          side: "to",
          placeUnplaced: true,
        }),
        location("loc-hull", "loc-leeds", { quantity: 12 }),
      ])
    ).map((row) => row.description);

    expect(descriptions).toEqual([
      "40 kg placed at Hull depot",
      "12 kg moved: Hull depot → Leeds unit",
    ]);
  });

  it("keeps a custom field's own values even when it is named like a record field", async () => {
    expect(
      await readableRows([
        event("ASSET_CUSTOM_FIELD_CHANGED", {
          field: "tags",
          fromValue: "red",
          toValue: "blue",
        }),
      ])
    ).toEqual([
      {
        description: "tags changed: red → blue",
        changedFrom: "red",
        changedTo: "blue",
      },
    ]);
    expect(db.tag.findMany).not.toHaveBeenCalled();
  });

  it("says what a cleared or first description was", async () => {
    const descriptions = (
      await readableRows([
        event("ASSET_DESCRIPTION_CHANGED", {
          field: "description",
          fromValue: "Dry goods",
        }),
        event("ASSET_DESCRIPTION_CHANGED", {
          field: "description",
          toValue: "Frozen goods",
        }),
      ])
    ).map((row) => row.description);

    expect(descriptions).toEqual([
      "Description removed, was Dry goods",
      "Description set to Frozen goods",
    ]);
  });

  it("names categories, models, tags and custom fields", async () => {
    const descriptions = (
      await readableRows([
        event("ASSET_CATEGORY_CHANGED", {
          field: "categoryId",
          toValue: "cat-food",
        }),
        event("ASSET_MODEL_CHANGED", {
          field: "assetModelId",
          fromValue: "model-euro",
        }),
        event("ASSET_TAGS_CHANGED", {
          field: "tags",
          fromValue: ["tag-cold", "tag-gone"],
          toValue: ["tag-cold", "tag-fragile"],
        }),
        event("ASSET_CUSTOM_FIELD_CHANGED", {
          field: "Serial number",
          toValue: "SN-1234",
        }),
        event("ASSET_CUSTOM_FIELD_CHANGED", {
          field: "Serial number",
          fromValue: "SN-1234",
          toValue: "SN-9999",
        }),
        event("ASSET_VALUATION_CHANGED", { field: "valuation", toValue: 1200 }),
        event("ASSET_NAME_CHANGED", {
          field: "name",
          fromValue: "Pallet",
          toValue: "Pallet 17",
        }),
        event("ASSET_CREATED"),
      ])
    ).map((row) => row.description);

    expect(descriptions).toEqual([
      "Category set to Food parcels",
      "Asset model removed, was Euro pallet",
      "Tags added: Fragile; removed: (deleted tag)",
      "Serial number set to SN-1234",
      "Serial number changed: SN-1234 → SN-9999",
      "Valuation set to 1,200",
      "Name changed: Pallet → Pallet 17",
      "Asset created",
    ]);
  });

  it("reads each record type once per page, scoped to the workspace", async () => {
    await readableRows([
      location("loc-leeds", "loc-hull"),
      location("loc-hull", "loc-leeds"),
      event("ASSET_CATEGORY_CHANGED", {
        field: "categoryId",
        toValue: "cat-food",
      }),
      event("ASSET_MODEL_CHANGED", {
        field: "assetModelId",
        toValue: "model-euro",
      }),
      event("ASSET_TAGS_CHANGED", {
        field: "tags",
        fromValue: [],
        toValue: ["tag-fragile"],
      }),
    ]);

    const scopedTo = (ids: string[]) => ({
      where: { id: { in: ids }, organizationId: ORG },
      select: { id: true, name: true },
    });
    expect(db.location.findMany).toHaveBeenCalledTimes(1);
    expect(db.location.findMany).toHaveBeenCalledWith(
      scopedTo(["loc-leeds", "loc-hull"])
    );
    expect(db.category.findMany).toHaveBeenCalledWith(scopedTo(["cat-food"]));
    expect(db.assetModel.findMany).toHaveBeenCalledWith(
      scopedTo(["model-euro"])
    );
    expect(db.tag.findMany).toHaveBeenCalledWith(scopedTo(["tag-fragile"]));
  });

  it("re-signs thumbnails for the page", async () => {
    await readableRows([event("ASSET_CREATED")]);

    expect(refreshExpiredAssetImages).toHaveBeenCalledTimes(1);
  });
});

describe("assetActivityReport export mode (allRows)", () => {
  const batchOf = (size: number) =>
    Array.from({ length: size }, () => location("loc-leeds", "loc-hull"));

  it("writes references and both sides of each change", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      location("loc-leeds", "loc-hull"),
    ] as never);

    const { rows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      allRows: true,
    });

    expect(rows).toEqual([
      expect.objectContaining({
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
    ]);
  });

  it("reads past one batch, counts the KPIs once and re-signs no thumbnails", async () => {
    vi.mocked(db.activityEvent.count).mockResolvedValue(5001);
    vi.mocked(db.activityEvent.findMany)
      .mockResolvedValueOnce(batchOf(5000) as never)
      .mockResolvedValueOnce([location("loc-hull", "loc-leeds")] as never);

    const { rows, totalRows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetId: "asset-1",
      // Export mode ignores the page the screen was on.
      page: 7,
      pageSize: 50,
      allRows: true,
    });

    expect(rows).toHaveLength(5001);
    expect(totalRows).toBe(5001);
    expect(rows[5000].description).toBe(
      "Location changed: Hull depot → Leeds unit"
    );
    const pages = vi
      .mocked(db.activityEvent.findMany)
      .mock.calls.map(([args]) => ({
        skip: args?.skip,
        take: args?.take,
        assetId: args?.where?.assetId,
      }));
    expect(pages).toEqual([
      { skip: 0, take: 5000, assetId: "asset-1" },
      { skip: 5000, take: 5000, assetId: "asset-1" },
    ]);
    expect(db.activityEvent.count).toHaveBeenCalledTimes(1);
    expect(db.activityEvent.groupBy).toHaveBeenCalledTimes(2);
    expect(refreshExpiredAssetImages).not.toHaveBeenCalled();
  });

  it("keeps the filter bar's asset filter on every batch", async () => {
    // Batch 1: the page ids, then the two summary counts. Batch 2: page ids.
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce(
        Array.from({ length: 5000 }, (_, i) => ({ id: `e${i}` })) as never
      )
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "last" }] as never);
    vi.mocked(db.activityEvent.findMany)
      .mockResolvedValueOnce(batchOf(5000) as never)
      .mockResolvedValueOnce([location("loc-hull", "loc-leeds")] as never);

    const { rows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetFilter: buildReportAssetFilter({ categoryIds: ["cat-food"] }),
      allRows: true,
    });

    expect(rows).toHaveLength(5001);
    const pageQueries = vi
      .mocked(db.$queryRaw)
      .mock.calls.map(([query]) => query as unknown as Prisma.Sql)
      .filter((query) => query.sql.includes("OFFSET"));
    expect(pageQueries).toHaveLength(2);
    for (const query of pageQueries) {
      expect(query.sql).toContain('FROM "Asset"');
      expect(query.values).toContain("cat-food");
    }
    expect(pageQueries.map((query) => query.values.slice(-2))).toEqual([
      [5000, 0],
      [5000, 5000],
    ]);
  });

  it("ends the export's timeframe when the export starts", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as never);
    const before = Date.now();

    await assetActivityReport({
      organizationId: ORG,
      // A range ending later than now, as a custom range ending today does.
      timeframe: { ...TIMEFRAME, to: new Date(before + 6 * 60 * 60 * 1000) },
      allRows: true,
    });

    const [args] = vi.mocked(db.activityEvent.findMany).mock.calls[0];
    const end = (args?.where?.occurredAt as { lte: Date }).lte.getTime();
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(Date.now());
  });

  it("stops at the ceiling and reports the full total", async () => {
    vi.mocked(db.activityEvent.count).mockResolvedValue(
      ACTIVITY_EXPORT_MAX_ROWS + 1
    );
    vi.mocked(db.activityEvent.findMany).mockResolvedValue(
      batchOf(5000) as never
    );

    const { rows, totalRows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      allRows: true,
    });

    expect(rows).toHaveLength(ACTIVITY_EXPORT_MAX_ROWS);
    expect(totalRows).toBe(ACTIVITY_EXPORT_MAX_ROWS + 1);
  });
});
