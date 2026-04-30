/**
 * Booking Compliance Report — Hero Tests
 *
 * Covers the `complianceData` block of the public `bookingComplianceReport`
 * function: that the hero counts measurable bookings (COMPLETE, OVERDUE,
 * ARCHIVED) using the canonical check-in time from `ActivityEvent` rather
 * than `Booking.updatedAt`.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { BookingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: We mock the Prisma client to avoid hitting the real database during
// unit tests. This matches the pattern established in
// `apps/webapp/app/modules/reports/check-in-time.server.test.ts`.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    activityEvent: {
      findMany: vi.fn(),
    },
    // why: `bookingStatusTransitionCounts` issues `db.$queryRaw` for the
    // chart series. We stub it to a resolved empty array so the hero-data
    // path is not coupled to chart math.
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";

import { bookingComplianceReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

describe("bookingComplianceReport — complianceData hero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no rows from booking queries (overridden per-test below).
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
    // Default: zero counts for KPI math (test asserts only on complianceData).
    vi.mocked(db.booking.count).mockResolvedValue(0 as any);
    // Default: no activity events.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);
    // Default: no chart rows from the raw query.
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  it("counts OVERDUE bookings as late", async () => {
    const dueDate = new Date("2026-04-15T12:00:00Z");

    const completeBooking = {
      id: "booking-complete",
      name: "Complete Booking",
      status: "COMPLETE",
      from: new Date("2026-04-14T12:00:00Z"),
      to: dueDate,
      updatedAt: dueDate,
      custodianUser: null,
      custodianTeamMember: null,
      custodianUserId: null,
      custodianTeamMemberId: null,
      _count: { assets: 1 },
    };
    const overdueBooking = {
      id: "booking-overdue",
      name: "Overdue Booking",
      status: "OVERDUE",
      from: new Date("2026-04-10T12:00:00Z"),
      to: dueDate,
      updatedAt: dueDate,
      custodianUser: null,
      custodianTeamMember: null,
      custodianUserId: null,
      custodianTeamMemberId: null,
      _count: { assets: 1 },
    };

    // why: Multiple internal helpers call `db.booking.findMany` with different
    // where clauses (rows fetch, compliance rate, trend, custodian
    // performance, prior-period rate). Returning the same dataset for every
    // call keeps the test focused on the hero `complianceData` shape; the
    // prior-period query also resolves with the same dataset, but it doesn't
    // affect the assertions on `onTime`/`late`/`rate`.
    vi.mocked(db.booking.findMany).mockResolvedValue([
      completeBooking,
      overdueBooking,
    ] as any);

    // why: `resolveCheckInTimes` queries `activityEvent.findMany`. Returning
    // a `BOOKING_STATUS_CHANGED → COMPLETE` event for the COMPLETE booking
    // exactly at its due date marks it on-time via `getLatenessMs`.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-complete", occurredAt: dueDate },
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData).toBeDefined();
    expect(result.complianceData!.onTime).toBe(1);
    expect(result.complianceData!.late).toBe(1);
    expect(result.complianceData!.rate).toBe(50);
  });

  it("counts ARCHIVED bookings using their check-in event timestamp", async () => {
    const dueDate = new Date("2026-04-15T12:00:00Z");
    // Check-in occurred 5 minutes after `to` — well within the 15-minute
    // grace window, so the booking is on-time.
    const checkInAt = new Date(dueDate.getTime() + 5 * 60 * 1000);

    const archivedBooking = {
      id: "booking-archived",
      name: "Archived Booking",
      status: "ARCHIVED",
      from: new Date("2026-04-14T12:00:00Z"),
      to: dueDate,
      updatedAt: new Date("2026-04-25T00:00:00Z"), // far after check-in (e.g. archive job)
      custodianUser: null,
      custodianTeamMember: null,
      custodianUserId: null,
      custodianTeamMemberId: null,
      _count: { assets: 1 },
    };

    vi.mocked(db.booking.findMany).mockResolvedValue([archivedBooking] as any);

    // why: The canonical check-in moment for an ARCHIVED booking is the
    // `BOOKING_STATUS_CHANGED → COMPLETE` event, NOT `Booking.updatedAt`
    // (which moves on the auto-archive job). Returning the on-time event
    // here proves the helper consumes the resolver's map, not `updatedAt`.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-archived", occurredAt: checkInAt },
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData).toBeDefined();
    expect(result.complianceData!.onTime).toBe(1);
    expect(result.complianceData!.late).toBe(0);
    expect(result.complianceData!.rate).toBe(100);
  });
});

describe("bookingComplianceReport — row builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
    vi.mocked(db.booking.count).mockResolvedValue(0 as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  afterEach(() => {
    // why: A test below installs fake timers; restoring after each test keeps
    // later tests deterministic regardless of which test ran last.
    vi.useRealTimers();
  });

  it("computes lateness as now − to for OVERDUE rows", async () => {
    // why: Pinning `now` to a fixed instant lets us assert an exact
    // `latenessMs` for the OVERDUE branch (`now − to`) without flakiness.
    const fixedNow = new Date("2026-04-30T12:00:00Z");
    vi.useFakeTimers().setSystemTime(fixedNow);

    const dueDate = new Date("2026-04-04T12:00:00Z"); // 26 days before now
    const overdueBooking = {
      id: "booking-overdue",
      name: "Overdue Booking",
      status: BookingStatus.OVERDUE,
      from: new Date("2026-04-03T12:00:00Z"),
      to: dueDate,
      // Buggy "lateness via updatedAt" would return ~2d 4h here. The canonical
      // helper must ignore this and use `now − to` instead (= 26 days).
      updatedAt: new Date("2026-04-06T16:00:00Z"),
      custodianUser: null,
      custodianTeamMember: null,
      custodianUserId: null,
      custodianTeamMemberId: null,
      _count: { assets: 1 },
    };

    vi.mocked(db.booking.findMany).mockResolvedValue([overdueBooking] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].latenessMs).toBe(26 * 24 * 60 * 60 * 1000);
    expect(result.rows[0].isOverdue).toBe(true);
  });

  it("includes ARCHIVED rows in the table", async () => {
    const archivedBooking = {
      id: "booking-archived",
      name: "Archived Booking",
      status: BookingStatus.ARCHIVED,
      from: new Date("2026-04-14T12:00:00Z"),
      to: new Date("2026-04-15T12:00:00Z"),
      updatedAt: new Date("2026-04-25T00:00:00Z"),
      custodianUser: null,
      custodianTeamMember: null,
      custodianUserId: null,
      custodianTeamMemberId: null,
      _count: { assets: 1 },
    };

    vi.mocked(db.booking.findMany).mockResolvedValue([archivedBooking] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe(BookingStatus.ARCHIVED);
  });
});
