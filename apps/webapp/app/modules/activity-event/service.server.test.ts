import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordEvent, recordEvents } from "./service.server";

// why: testing service logic without hitting the real database
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: { create: vi.fn() },
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
      });

      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(activityEventCreateMock.mock.calls[0][0].data).toMatchObject({
        actorSnapshot: { firstName: "Prefetched", lastName: "User" },
      });
    });

    it("writes a null actorSnapshot for system events with no actor", async () => {
      await recordEvent({
        organizationId: "org-1",
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: "asset-1",
      });

      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(activityEventCreateMock.mock.calls[0][0].data.actorSnapshot).toBe(
        null
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
      expect(userFindUniqueMock).not.toHaveBeenCalled();
    });

    it("writes one row per input and caches actor snapshots by actorUserId", async () => {
      await recordEvents([
        {
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "BOOKING_ASSETS_ADDED",
          entityType: "BOOKING",
          entityId: "booking-1",
          bookingId: "booking-1",
          assetId: "asset-a",
        },
        {
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "BOOKING_ASSETS_ADDED",
          entityType: "BOOKING",
          entityId: "booking-1",
          bookingId: "booking-1",
          assetId: "asset-b",
        },
      ]);

      // Two writes, one user lookup (cached)
      expect(activityEventCreateMock).toHaveBeenCalledTimes(2);
      expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
    });
  });
});
