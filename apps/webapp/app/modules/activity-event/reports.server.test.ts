import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assetChangeHistory,
  auditCompletionStats,
  bookingStatusTransitionCounts,
  custodyDurationsByAsset,
} from "./reports.server";

// why: isolate report queries from the real database
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// why: ShelfError implementation details irrelevant to these tests
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

const mockDb = await import("~/database/db.server");
const findManyMock = vi.mocked(mockDb.db.activityEvent.findMany);
const queryRawMock = vi.mocked(mockDb.db.$queryRaw);

const org = "org-1";
const from = new Date("2026-01-01T00:00:00Z");
const to = new Date("2026-02-01T00:00:00Z");

describe("activity event reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assetChangeHistory", () => {
    it("queries asset-scoped actions for the given asset and window", async () => {
      findManyMock.mockResolvedValueOnce([
        {
          id: "evt-1",
          occurredAt: new Date("2026-01-10"),
          action: "ASSET_NAME_CHANGED",
          entityType: "ASSET",
          entityId: "asset-1",
          actorUserId: "user-1",
          actorSnapshot: { firstName: "Jane", lastName: "Doe" },
          field: "name",
          fromValue: "Old",
          toValue: "New",
          meta: null,
        } as any,
      ]);

      const result = await assetChangeHistory({
        organizationId: org,
        assetId: "asset-1",
        from,
        to,
      });

      expect(findManyMock).toHaveBeenCalledTimes(1);
      const whereArg = findManyMock.mock.calls[0][0]?.where;
      expect(whereArg).toMatchObject({
        organizationId: org,
        assetId: "asset-1",
        occurredAt: { gte: from, lte: to },
      });
      expect(whereArg?.action).toHaveProperty("in");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        action: "ASSET_NAME_CHANGED",
        field: "name",
        fromValue: "Old",
        toValue: "New",
      });
    });
  });

  describe("bookingStatusTransitionCounts", () => {
    it("runs a raw groupBy over the JSON toValue and coerces bigint counts", async () => {
      queryRawMock.mockResolvedValueOnce([
        { to_status: "ONGOING", count: 4n },
        { to_status: "COMPLETE", count: 2n },
      ] as any);

      const result = await bookingStatusTransitionCounts({
        organizationId: org,
        from,
        to,
      });

      expect(queryRawMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { toStatus: "ONGOING", count: 4 },
        { toStatus: "COMPLETE", count: 2 },
      ]);
    });
  });

  describe("auditCompletionStats", () => {
    it("returns rows with meta payload and filters out any with missing auditSessionId", async () => {
      findManyMock.mockResolvedValueOnce([
        {
          auditSessionId: "audit-1",
          actorUserId: "user-1",
          occurredAt: new Date("2026-01-15"),
          meta: { expectedCount: 10, foundCount: 8 },
        },
        {
          auditSessionId: null, // should be filtered
          actorUserId: "user-2",
          occurredAt: new Date("2026-01-16"),
          meta: {},
        },
      ] as any);

      const result = await auditCompletionStats({
        organizationId: org,
        from,
        to,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        auditSessionId: "audit-1",
        meta: { expectedCount: 10, foundCount: 8 },
      });
    });
  });

  describe("custodyDurationsByAsset", () => {
    it("pairs CUSTODY_ASSIGNED with a following CUSTODY_RELEASED via raw SQL", async () => {
      const heldFrom = new Date("2026-01-05T09:00:00Z");
      const heldTo = new Date("2026-01-05T17:00:00Z");
      queryRawMock.mockResolvedValueOnce([
        {
          asset_id: "asset-1",
          actor_user_id: "user-1",
          held_from: heldFrom,
          held_to: heldTo,
        },
        {
          asset_id: "asset-2",
          actor_user_id: null,
          held_from: heldFrom,
          held_to: null, // still held
        },
      ] as any);

      const result = await custodyDurationsByAsset({
        organizationId: org,
        from,
        to,
      });

      expect(result).toEqual([
        {
          assetId: "asset-1",
          actorUserId: "user-1",
          heldFrom,
          heldTo,
          durationSeconds: 8 * 3600,
        },
        {
          assetId: "asset-2",
          actorUserId: null,
          heldFrom,
          heldTo: null,
          durationSeconds: null,
        },
      ]);
    });
  });

  it("wraps DB errors with label 'Activity' and the helper name", async () => {
    findManyMock.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      assetChangeHistory({
        organizationId: org,
        assetId: "asset-1",
        from,
        to,
      })
    ).rejects.toMatchObject({
      label: "Activity",
      additionalData: expect.objectContaining({ helper: "assetChangeHistory" }),
    });
  });
});
