import { beforeEach, describe, expect, it, vi } from "vitest";

// why: We mock the Prisma client to avoid hitting the real database during
// unit tests. This matches the pattern used by other server-module tests
// (e.g. apps/webapp/app/modules/note/service.server.test.ts).
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { resolveCheckInTimes } from "./check-in-time.server";

describe("resolveCheckInTimes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty Map and does NOT call the database when given no booking ids", async () => {
    const result = await resolveCheckInTimes([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(db.activityEvent.findMany).not.toHaveBeenCalled();
  });

  it("returns the latest event per booking when multiple events exist", async () => {
    const earlierComplete = new Date("2026-04-01T10:00:00Z");
    const laterComplete = new Date("2026-04-03T15:30:00Z");
    const otherBookingComplete = new Date("2026-04-02T08:00:00Z");

    // events are returned in ascending order; later events overwrite earlier
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-1", occurredAt: earlierComplete },
      { bookingId: "booking-2", occurredAt: otherBookingComplete },
      { bookingId: "booking-1", occurredAt: laterComplete },
    ] as any);

    const result = await resolveCheckInTimes([
      "booking-1",
      "booking-2",
      "booking-3",
    ]);

    expect(result.get("booking-1")).toEqual(laterComplete);
    expect(result.get("booking-2")).toEqual(otherBookingComplete);
    expect(result.has("booking-3")).toBe(false);
    expect(result.size).toBe(2);
  });

  it("omits bookings that have no matching event from the Map", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-1", occurredAt: new Date("2026-04-01T10:00:00Z") },
    ] as any);

    const result = await resolveCheckInTimes(["booking-1", "booking-2"]);

    expect(result.has("booking-1")).toBe(true);
    expect(result.has("booking-2")).toBe(false);
  });

  it("issues a single batched Prisma query with the expected where/select/orderBy", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);

    const ids = ["booking-1", "booking-2", "booking-3"];
    await resolveCheckInTimes(ids);

    expect(db.activityEvent.findMany).toHaveBeenCalledTimes(1);
    expect(db.activityEvent.findMany).toHaveBeenCalledWith({
      where: {
        action: "BOOKING_STATUS_CHANGED",
        // `toValue` is a JSON column → use the `{ equals: ... }` JSON filter.
        toValue: { equals: "COMPLETE" },
        bookingId: { in: ids },
      },
      select: { bookingId: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    });
  });

  it("defensively skips events whose bookingId is null", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: null, occurredAt: new Date("2026-04-01T10:00:00Z") },
      { bookingId: "booking-1", occurredAt: new Date("2026-04-02T10:00:00Z") },
    ] as any);

    const result = await resolveCheckInTimes(["booking-1"]);

    expect(result.size).toBe(1);
    expect(result.get("booking-1")).toEqual(new Date("2026-04-02T10:00:00Z"));
  });
});
