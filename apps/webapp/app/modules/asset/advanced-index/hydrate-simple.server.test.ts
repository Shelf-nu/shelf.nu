// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_DB_AVAILABLE, getFixtureDb } from "@tooling/fixture-db";
import {
  fetchCustomFieldsBatch,
  fetchKitsBatch,
  fetchLocationsBatch,
  fetchRemindersBatch,
  fetchTagsBatch,
} from "./hydrate-simple.server";
import type { BatchArgs } from "./types";

/**
 * Two layers of coverage for the 5 simple hydration batches:
 *
 * 1. Mocked unit tests (below, run on every `pnpm webapp:test`): assert
 *    org-scoping, grouping, empty-omission, and ordering against a mocked
 *    Prisma client — no database required.
 * 2. Real-DB smokes (bottom of the file): the same batches against a real,
 *    read-only fixture database, skipped automatically when
 *    `FIXTURE_DATABASE_URL` isn't configured. Raw SQL elsewhere in this
 *    feature can't be typechecked at all; these batches use typed Prisma, so
 *    the smokes exist mainly to catch a `select`/relation mismatch a mock
 *    can't — the mock only ever returns what the test tells it to.
 */

type MockDb = {
  tag: { findMany: ReturnType<typeof vi.fn> };
  assetLocation: { findMany: ReturnType<typeof vi.fn> };
  assetKit: { findMany: ReturnType<typeof vi.fn> };
  assetCustomFieldValue: { findMany: ReturnType<typeof vi.fn> };
  assetReminder: { findMany: ReturnType<typeof vi.fn> };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  tag: { findMany: vi.fn() },
  assetLocation: { findMany: vi.fn() },
  assetKit: { findMany: vi.fn() },
  assetCustomFieldValue: { findMany: vi.fn() },
  assetReminder: { findMany: vi.fn() },
}));

// why: isolating the batch queries from a real database for unit testing —
// each test asserts the exact `where`/`orderBy` shape the batch sends and
// controls exactly what rows come back, which a real database can't offer
// deterministically.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const ORG_ID = "org-1";
const VIEWER_SCOPE = { userId: "user-1", canSeeAllCustody: true };

/** Base `BatchArgs` shared by every test; individual tests override fields. */
function makeArgs(overrides: Partial<BatchArgs> = {}): BatchArgs {
  return {
    ids: ["asset-1", "asset-2"],
    organizationId: ORG_ID,
    viewerScope: VIEWER_SCOPE,
    barcodesEnabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.tag.findMany.mockReset();
  dbMock.assetLocation.findMany.mockReset();
  dbMock.assetKit.findMany.mockReset();
  dbMock.assetCustomFieldValue.findMany.mockReset();
  dbMock.assetReminder.findMany.mockReset();
});

describe("fetchTagsBatch", () => {
  it("scopes the query to the caller's organization and the requested ids", async () => {
    dbMock.tag.findMany.mockResolvedValue([]);
    const args = makeArgs();

    await fetchTagsBatch(args);

    const call = dbMock.tag.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.assets.some.id.in).toEqual(args.ids);
    expect(call.where.assets.some.organizationId).toBe(ORG_ID);
  });

  it("orders tags by id ascending to match the legacy DISTINCT-jsonb aggregate order", async () => {
    dbMock.tag.findMany.mockResolvedValue([]);

    await fetchTagsBatch(makeArgs());

    const call = dbMock.tag.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ id: "asc" });
  });

  it("groups tags into a Map keyed by assetId, omitting assets with none", async () => {
    dbMock.tag.findMany.mockResolvedValue([
      {
        id: "tag-1",
        name: "Fragile",
        color: "#ff0000",
        assets: [{ id: "asset-1" }, { id: "asset-2" }],
      },
      {
        id: "tag-2",
        name: "Outdoor",
        color: null,
        assets: [{ id: "asset-1" }],
      },
    ]);

    const map = await fetchTagsBatch(
      makeArgs({ ids: ["asset-1", "asset-2", "asset-3"] })
    );

    expect(map.get("asset-1")).toEqual([
      { id: "tag-1", name: "Fragile", color: "#ff0000" },
      { id: "tag-2", name: "Outdoor", color: null },
    ]);
    expect(map.get("asset-2")).toEqual([
      { id: "tag-1", name: "Fragile", color: "#ff0000" },
    ]);
    // asset-3 has no tags in the mocked response — omitted, not [].
    expect(map.has("asset-3")).toBe(false);
  });
});

describe("fetchLocationsBatch", () => {
  it("scopes the query to the caller's organization and the requested ids", async () => {
    dbMock.assetLocation.findMany.mockResolvedValue([]);
    const args = makeArgs();

    await fetchLocationsBatch(args);

    const call = dbMock.assetLocation.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.assetId.in).toEqual(args.ids);
  });

  it("orders by the pivot row's createdAt ascending, then id, to match the primary-pick convention", async () => {
    dbMock.assetLocation.findMany.mockResolvedValue([]);

    await fetchLocationsBatch(makeArgs());

    const call = dbMock.assetLocation.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("groups placements by assetId, preserving query order so element 0 is the primary", async () => {
    dbMock.assetLocation.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        location: {
          id: "loc-old",
          name: "Warehouse A",
          parentId: null,
          _count: { children: 2 },
        },
      },
      {
        assetId: "asset-1",
        location: {
          id: "loc-new",
          name: "Warehouse B",
          parentId: "parent-1",
          _count: { children: 0 },
        },
      },
    ]);

    const map = await fetchLocationsBatch(
      makeArgs({ ids: ["asset-1", "asset-2"] })
    );

    expect(map.get("asset-1")).toEqual([
      { id: "loc-old", name: "Warehouse A", parentId: null, childCount: 2 },
      {
        id: "loc-new",
        name: "Warehouse B",
        parentId: "parent-1",
        childCount: 0,
      },
    ]);
    expect(map.has("asset-2")).toBe(false);
  });
});

describe("fetchKitsBatch", () => {
  it("scopes the query to the caller's organization and the requested ids", async () => {
    dbMock.assetKit.findMany.mockResolvedValue([]);
    const args = makeArgs();

    await fetchKitsBatch(args);

    const call = dbMock.assetKit.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.assetId.in).toEqual(args.ids);
  });

  it("orders by the pivot row's createdAt ascending, then id, to match the primary-pick convention", async () => {
    dbMock.assetKit.findMany.mockResolvedValue([]);

    await fetchKitsBatch(makeArgs());

    const call = dbMock.assetKit.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("groups kit memberships by assetId, preserving query order so element 0 is the primary", async () => {
    dbMock.assetKit.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        kit: { id: "kit-old", name: "Camera Kit", status: "AVAILABLE" },
      },
      {
        assetId: "asset-1",
        kit: { id: "kit-new", name: "Backup Kit", status: "CHECKED_OUT" },
      },
    ]);

    const map = await fetchKitsBatch(makeArgs({ ids: ["asset-1", "asset-2"] }));

    expect(map.get("asset-1")).toEqual([
      { id: "kit-old", name: "Camera Kit", status: "AVAILABLE" },
      { id: "kit-new", name: "Backup Kit", status: "CHECKED_OUT" },
    ]);
    expect(map.has("asset-2")).toBe(false);
  });
});

describe("fetchCustomFieldsBatch", () => {
  it("scopes the query to the caller's organization via both the asset and customField relations", async () => {
    dbMock.assetCustomFieldValue.findMany.mockResolvedValue([]);
    const args = makeArgs();

    await fetchCustomFieldsBatch(args);

    const call = dbMock.assetCustomFieldValue.findMany.mock.calls[0][0];
    expect(call.where.assetId.in).toEqual(args.ids);
    expect(call.where.asset.organizationId).toBe(ORG_ID);
    expect(call.where.customField.organizationId).toBe(ORG_ID);
    expect(call.where.customField.active).toBe(true);
    expect(call.where.customField.id).toBeUndefined();
  });

  it("honors requestedFieldIds by narrowing the customField id filter", async () => {
    dbMock.assetCustomFieldValue.findMany.mockResolvedValue([]);

    await fetchCustomFieldsBatch(
      makeArgs({ requestedFieldIds: ["field-1", "field-2"] })
    );

    const call = dbMock.assetCustomFieldValue.findMany.mock.calls[0][0];
    expect(call.where.customField.id.in).toEqual(["field-1", "field-2"]);
  });

  it("groups values by assetId, omitting assets with none, and narrows null category lists", async () => {
    dbMock.assetCustomFieldValue.findMany.mockResolvedValue([
      {
        id: "acfv-1",
        assetId: "asset-1",
        value: { raw: "blue" },
        customField: {
          id: "field-1",
          name: "Color",
          helpText: null,
          required: false,
          type: "TEXT",
          options: [],
          categories: [],
        },
      },
    ]);

    const map = await fetchCustomFieldsBatch(
      makeArgs({ ids: ["asset-1", "asset-2"] })
    );

    expect(map.get("asset-1")).toEqual([
      {
        id: "acfv-1",
        value: { raw: "blue" },
        customField: {
          id: "field-1",
          name: "Color",
          helpText: null,
          required: false,
          type: "TEXT",
          options: [],
          categories: null,
        },
      },
    ]);
    expect(map.has("asset-2")).toBe(false);
  });
});

describe("fetchRemindersBatch", () => {
  it("scopes the query to the caller's organization, the requested ids, and future alerts", async () => {
    dbMock.assetReminder.findMany.mockResolvedValue([]);
    const args = makeArgs();

    await fetchRemindersBatch(args);

    const call = dbMock.assetReminder.findMany.mock.calls[0][0];
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.where.assetId.in).toEqual(args.ids);
    expect(call.where.alertDateTime.gte).toBeInstanceOf(Date);
    expect(call.orderBy).toEqual({ alertDateTime: "asc" });
  });

  it("keeps only the earliest reminder per asset and formats alertDateTime as a string", async () => {
    const soon = new Date("2026-09-01T10:00:00.000Z");
    const later = new Date("2026-09-05T10:00:00.000Z");
    dbMock.assetReminder.findMany.mockResolvedValue([
      {
        id: "reminder-soon",
        assetId: "asset-1",
        name: "Service due",
        message: "Time for annual service",
        alertDateTime: soon,
      },
      {
        id: "reminder-later",
        assetId: "asset-1",
        name: "Warranty expiring",
        message: "Warranty ends soon",
        alertDateTime: later,
      },
    ]);

    const map = await fetchRemindersBatch(
      makeArgs({ ids: ["asset-1", "asset-2"] })
    );

    expect(map.get("asset-1")).toEqual({
      id: "reminder-soon",
      name: "Service due",
      message: "Time for annual service",
      alertDateTime: soon.toISOString(),
    });
    expect(map.has("asset-2")).toBe(false);
  });
});

describe("real-DB smokes", () => {
  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchTagsBatch returns org-scoped grouped tags",
    async () => {
      const db = getFixtureDb();
      const sample = await db.tag.findFirst({
        where: { assets: { some: {} } },
        select: {
          organizationId: true,
          assets: { take: 3, select: { id: true } },
        },
      });
      if (!sample || sample.assets.length === 0) {
        // Fixture has no tagged assets to exercise — nothing further to
        // assert, but the query above already proved the client + schema
        // agree on the `Tag`/`assets` relation shape.
        return;
      }

      const map = await fetchTagsBatch(
        makeArgs({
          ids: sample.assets.map((a) => a.id),
          organizationId: sample.organizationId,
        }),
        db
      );

      for (const [assetId, tags] of map) {
        expect(sample.assets.map((a) => a.id)).toContain(assetId);
        for (const tag of tags) {
          expect(typeof tag.id).toBe("string");
          expect(typeof tag.name).toBe("string");
        }
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchLocationsBatch returns org-scoped grouped, ordered placements",
    async () => {
      const db = getFixtureDb();
      const sample = await db.assetLocation.findFirst({
        select: { assetId: true, organizationId: true },
      });
      if (!sample) return;

      const map = await fetchLocationsBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.organizationId,
        }),
        db
      );

      const placements = map.get(sample.assetId);
      expect(placements).toBeDefined();
      expect(placements!.length).toBeGreaterThan(0);
      for (const location of placements!) {
        expect(typeof location.id).toBe("string");
        expect(typeof location.childCount).toBe("number");
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchKitsBatch returns org-scoped grouped, ordered kit memberships",
    async () => {
      const db = getFixtureDb();
      const sample = await db.assetKit.findFirst({
        select: { assetId: true, organizationId: true },
      });
      if (!sample) return;

      const map = await fetchKitsBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.organizationId,
        }),
        db
      );

      const kits = map.get(sample.assetId);
      expect(kits).toBeDefined();
      expect(kits!.length).toBeGreaterThan(0);
      for (const kit of kits!) {
        expect(typeof kit.id).toBe("string");
        expect(typeof kit.status).toBe("string");
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchCustomFieldsBatch returns org-scoped grouped custom-field values",
    async () => {
      const db = getFixtureDb();
      const sample = await db.assetCustomFieldValue.findFirst({
        select: {
          assetId: true,
          customField: { select: { organizationId: true } },
        },
      });
      if (!sample) return;

      const map = await fetchCustomFieldsBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.customField.organizationId,
        }),
        db
      );

      const values = map.get(sample.assetId);
      expect(values).toBeDefined();
      expect(values!.length).toBeGreaterThan(0);
      for (const value of values!) {
        expect(typeof value.customField.name).toBe("string");
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchRemindersBatch returns the soonest future reminder per asset",
    async () => {
      const db = getFixtureDb();
      const sample = await db.assetReminder.findFirst({
        where: { alertDateTime: { gte: new Date() } },
        select: { assetId: true, organizationId: true },
      });
      if (!sample) return;

      const map = await fetchRemindersBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.organizationId,
        }),
        db
      );

      const reminder = map.get(sample.assetId);
      expect(reminder).toBeDefined();
      expect(typeof reminder!.alertDateTime).toBe("string");
    }
  );
});
