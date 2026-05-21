import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createActivityEventInput } from "@factories";

import { recordEvent, recordEvents } from "./service.server";

// why: testing service logic without hitting the real database
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: { create: vi.fn(), createMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

// why: avoid ShelfError implementation details leaking into assertions
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

const mockDb = await import("~/database/db.server");
const activityEventCreateMock = vi.mocked(mockDb.db.activityEvent.create);
const activityEventCreateManyMock = vi.mocked(
  mockDb.db.activityEvent.createMany
);
const userFindUniqueMock = vi.mocked(mockDb.db.user.findUnique);

describe("activity event service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
      displayName: "Jane Doe",
    } as any);
    activityEventCreateMock.mockResolvedValue({} as any);
    activityEventCreateManyMock.mockResolvedValue({ count: 0 } as any);
  });

  describe("recordEvent", () => {
    it("persists the event with actor snapshot fetched from the actorUserId", async () => {
      await recordEvent({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
      });

      expect(userFindUniqueMock).toHaveBeenCalledWith({
        where: { id: "user-1" },
        select: { firstName: true, lastName: true, displayName: true },
      });
      expect(activityEventCreateMock).toHaveBeenCalledTimes(1);
      const createArg = activityEventCreateMock.mock.calls[0][0];
      expect(createArg.data).toMatchObject({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        actorSnapshot: {
          firstName: "Jane",
          lastName: "Doe",
          displayName: "Jane Doe",
        },
      });
    });

    it("prefers a pre-supplied actorSnapshot over fetching", async () => {
      await recordEvent({
        organizationId: "org-1",
        actorUserId: "user-1",
        actorSnapshot: { firstName: "Prefetched", lastName: "User" },
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
      });

      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(activityEventCreateMock.mock.calls[0][0].data).toMatchObject({
        actorSnapshot: { firstName: "Prefetched", lastName: "User" },
      });
    });

    it("writes Prisma.DbNull actorSnapshot for system events with no actor", async () => {
      await recordEvent({
        organizationId: "org-1",
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
      });

      expect(userFindUniqueMock).not.toHaveBeenCalled();
      // Prisma.DbNull is used for explicit null in JSON columns
      expect(activityEventCreateMock.mock.calls[0][0].data.actorSnapshot).toBe(
        Prisma.DbNull
      );
    });

    it("persists field/fromValue/toValue for *_CHANGED actions", async () => {
      await recordEvent({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "ASSET_VALUATION_CHANGED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        field: "valuation",
        fromValue: 100,
        toValue: 150,
      });

      expect(activityEventCreateMock.mock.calls[0][0].data).toMatchObject({
        field: "valuation",
        fromValue: 100,
        toValue: 150,
      });
    });

    it("uses the supplied tx client for both user lookup and event write", async () => {
      const txCreate = vi.fn().mockResolvedValue({});
      const txFindUnique = vi.fn().mockResolvedValue({
        firstName: "Tx",
        lastName: "User",
        displayName: null,
      });
      const tx = {
        activityEvent: { create: txCreate },
        user: { findUnique: txFindUnique },
      } as any;

      await recordEvent(
        {
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "ASSET_CREATED",
          entityType: "ASSET",
          entityId: "asset-1",
          assetId: "asset-1",
        },
        tx
      );

      expect(txFindUnique).toHaveBeenCalled();
      expect(txCreate).toHaveBeenCalled();
      // And the top-level db mocks should NOT have been touched
      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(activityEventCreateMock).not.toHaveBeenCalled();
    });

    it("wraps DB errors in a ShelfError labelled 'Activity'", async () => {
      activityEventCreateMock.mockRejectedValueOnce(new Error("boom"));

      await expect(
        recordEvent({
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "ASSET_CREATED",
          entityType: "ASSET",
          entityId: "asset-1",
          assetId: "asset-1",
        })
      ).rejects.toMatchObject({
        label: "Activity",
        message: "Failed to record activity event.",
      });
    });
  });

  describe("recordEvents", () => {
    it("is a no-op for empty input", async () => {
      await recordEvents([]);
      expect(activityEventCreateMock).not.toHaveBeenCalled();
      expect(activityEventCreateManyMock).not.toHaveBeenCalled();
      expect(userFindUniqueMock).not.toHaveBeenCalled();
    });

    it("writes all rows in a single createMany call and caches actor snapshots by actorUserId", async () => {
      await recordEvents([
        createActivityEventInput({ assetId: "asset-a" }),
        createActivityEventInput({ assetId: "asset-b" }),
      ]);

      // why: bulk inserts must be a single round-trip to fit inside the
      // 5s Prisma interactive-tx budget (Sentry SHELF-WEBAPP-1KN). A
      // per-row loop blew the budget for large bookings (262 assets).
      expect(activityEventCreateManyMock).toHaveBeenCalledTimes(1);
      expect(activityEventCreateMock).not.toHaveBeenCalled();
      expect(userFindUniqueMock).toHaveBeenCalledTimes(1);

      const createManyArg = activityEventCreateManyMock.mock.calls[0][0];
      // why: Prisma types `data` as `X | X[]`; narrow to array for indexing.
      const rows =
        createManyArg.data as Prisma.ActivityEventUncheckedCreateInput[];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        assetId: "asset-a",
        action: "BOOKING_ASSETS_ADDED",
        actorSnapshot: {
          firstName: "Jane",
          lastName: "Doe",
          displayName: "Jane Doe",
        },
      });
      expect(rows[1]).toMatchObject({
        assetId: "asset-b",
        action: "BOOKING_ASSETS_ADDED",
      });
    });

    it("resolves a distinct snapshot per actorUserId (cache keyed by actor)", async () => {
      userFindUniqueMock
        .mockResolvedValueOnce({
          firstName: "Alice",
          lastName: "A",
          displayName: "Alice A",
        } as any)
        .mockResolvedValueOnce({
          firstName: "Bob",
          lastName: "B",
          displayName: "Bob B",
        } as any);

      await recordEvents([
        createActivityEventInput({
          actorUserId: "user-alice",
          assetId: "asset-a",
        }),
        createActivityEventInput({
          actorUserId: "user-bob",
          assetId: "asset-b",
        }),
        createActivityEventInput({
          actorUserId: "user-alice",
          assetId: "asset-c",
        }),
      ]);

      // Two unique actors → two user lookups; the repeat hits the cache.
      expect(userFindUniqueMock).toHaveBeenCalledTimes(2);
      expect(activityEventCreateManyMock).toHaveBeenCalledTimes(1);

      // why: Prisma types `data` as `X | X[]`; narrow to array for indexing.
      const rows = activityEventCreateManyMock.mock.calls[0][0]
        .data as Prisma.ActivityEventUncheckedCreateInput[];
      expect(rows[0]).toMatchObject({
        actorUserId: "user-alice",
        actorSnapshot: { firstName: "Alice" },
      });
      expect(rows[1]).toMatchObject({
        actorUserId: "user-bob",
        actorSnapshot: { firstName: "Bob" },
      });
      expect(rows[2]).toMatchObject({
        actorUserId: "user-alice",
        actorSnapshot: { firstName: "Alice" },
      });
    });

    it("wraps createMany failures in a ShelfError labelled 'Activity'", async () => {
      activityEventCreateManyMock.mockRejectedValueOnce(new Error("boom"));

      await expect(
        recordEvents([createActivityEventInput({ assetId: "asset-a" })])
      ).rejects.toMatchObject({
        label: "Activity",
        message: "Failed to record activity events.",
      });
    });
  });
});
