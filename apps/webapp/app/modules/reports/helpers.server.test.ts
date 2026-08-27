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

/** A booking row shaped like `fetchBookingComplianceRows`' `select`. */
type ComplianceBookingFixture = {
  id: string;
  name: string;
  status: BookingStatus;
  from: Date;
  to: Date;
  originalFrom: Date | null;
  originalTo: Date | null;
  updatedAt: Date;
  custodianUser: null;
  custodianTeamMember: null;
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
  _count: { bookingAssets: number };
};

/**
 * Builds a booking row in exactly the shape the compliance queries select —
 * both date pairs, and `_count.bookingAssets` (the explicit pivot, not the
 * pre-pivot `assets`). Fixtures are the only thing standing between these
 * tests and a payload change, so they must not be hand-assembled per test:
 * a key the loader does not read still produces a green, meaningless run.
 *
 * `updatedAt` defaults to `to` (returned exactly on time) so tests that don't
 * care about the check-in fallback don't have to state it.
 *
 * @param overrides - The fields the test is actually about.
 * @returns A row for a `db.booking.findMany` mock.
 */
function makeComplianceBooking(
  overrides: Partial<ComplianceBookingFixture> = {}
): ComplianceBookingFixture {
  const to = overrides.to ?? new Date("2026-04-15T12:00:00Z");
  return {
    id: "booking-1",
    name: "Test Booking",
    status: BookingStatus.COMPLETE,
    from: new Date("2026-04-14T12:00:00Z"),
    to,
    originalFrom: null,
    originalTo: null,
    updatedAt: to,
    custodianUser: null,
    custodianTeamMember: null,
    custodianUserId: null,
    custodianTeamMemberId: null,
    _count: { bookingAssets: 1 },
    ...overrides,
  };
}

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

    const completeBooking = makeComplianceBooking({
      id: "booking-complete",
      name: "Complete Booking",
      status: BookingStatus.COMPLETE,
      to: dueDate,
    });
    const overdueBooking = makeComplianceBooking({
      id: "booking-overdue",
      name: "Overdue Booking",
      status: BookingStatus.OVERDUE,
      from: new Date("2026-04-10T12:00:00Z"),
      to: dueDate,
    });

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

  it("excludes never-returned archives (archivedWithoutCheckin) from every booking query", async () => {
    // why: A booking archived straight from RESERVED was never checked in, so
    // it must not be measured for on-time-return compliance. The exclusion is
    // enforced at the query layer — every booking read in the compliance flow
    // filters on `archivedWithoutCheckin: false`, so archived-from-reserved
    // rows never reach the count, rows, rate, trend, or custodian breakdown.
    await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const findManyCalls = vi.mocked(db.booking.findMany).mock.calls;
    expect(findManyCalls.length).toBeGreaterThan(0);
    for (const [args] of findManyCalls) {
      expect((args as any).where.archivedWithoutCheckin).toBe(false);
    }

    const countCalls = vi.mocked(db.booking.count).mock.calls;
    expect(countCalls.length).toBeGreaterThan(0);
    for (const [args] of countCalls) {
      expect((args as any).where.archivedWithoutCheckin).toBe(false);
    }
  });

  it("falls back to updatedAt for COMPLETE bookings missing a check-in event", async () => {
    // why: The partial-check-in completion path historically wrote a custom
    // system note instead of calling `createStatusTransitionNote`, so no
    // `BOOKING_STATUS_CHANGED → COMPLETE` event was recorded for those
    // bookings. Without a fallback, every such booking would be counted as
    // on-time regardless of when it was actually returned. With the fallback,
    // a COMPLETE booking returned 1h late (well past the 15m grace window) is
    // correctly counted as late via `Booking.updatedAt`.
    const dueDate = new Date("2026-04-15T12:00:00Z");
    const updatedAt = new Date(dueDate.getTime() + 60 * 60 * 1000); // 1h late

    vi.mocked(db.booking.findMany).mockResolvedValue([
      makeComplianceBooking({
        id: "booking-no-event",
        name: "Partial Check-in",
        to: dueDate,
        updatedAt,
      }),
    ] as any);
    // No activity event for this booking — the resolver returns an empty map
    // and `resolveCheckInAt` must fall back to `updatedAt`.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData!.onTime).toBe(0);
    expect(result.complianceData!.late).toBe(1);
    expect(result.complianceData!.rate).toBe(0);
  });

  it("does NOT fall back to updatedAt for ARCHIVED without an event", async () => {
    // why: For ARCHIVED bookings `Booking.updatedAt` is unreliable — the
    // auto-archive job shifts it long after the actual check-in. Falling back
    // to `updatedAt` here would systematically misreport archived bookings as
    // very late. With no event, the booking carries no measurable signal and
    // is treated as on-time per `isOnTime`'s null-data semantics.
    const dueDate = new Date("2026-04-15T12:00:00Z");

    vi.mocked(db.booking.findMany).mockResolvedValue([
      makeComplianceBooking({
        id: "booking-archived-no-event",
        name: "Legacy Archived",
        status: BookingStatus.ARCHIVED,
        to: dueDate,
        // 10 days after due date — would mark as very late if fallback applied.
        updatedAt: new Date(dueDate.getTime() + 10 * 24 * 60 * 60 * 1000),
      }),
    ] as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData!.onTime).toBe(1);
    expect(result.complianceData!.late).toBe(0);
  });

  it("counts ARCHIVED bookings using their check-in event timestamp", async () => {
    const dueDate = new Date("2026-04-15T12:00:00Z");
    // Check-in occurred 5 minutes after `to` — well within the 15-minute
    // grace window, so the booking is on-time.
    const checkInAt = new Date(dueDate.getTime() + 5 * 60 * 1000);

    const archivedBooking = makeComplianceBooking({
      id: "booking-archived",
      name: "Archived Booking",
      status: BookingStatus.ARCHIVED,
      to: dueDate,
      updatedAt: new Date("2026-04-25T00:00:00Z"), // far after check-in (e.g. archive job)
    });

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
    const overdueBooking = makeComplianceBooking({
      id: "booking-overdue",
      name: "Overdue Booking",
      status: BookingStatus.OVERDUE,
      from: new Date("2026-04-03T12:00:00Z"),
      to: dueDate,
      // Buggy "lateness via updatedAt" would return ~2d 4h here. The canonical
      // helper must ignore this and use `now − planned end` instead (26 days).
      updatedAt: new Date("2026-04-06T16:00:00Z"),
    });

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
    const archivedBooking = makeComplianceBooking({
      id: "booking-archived",
      name: "Archived Booking",
      status: BookingStatus.ARCHIVED,
      updatedAt: new Date("2026-04-25T00:00:00Z"),
    });

    vi.mocked(db.booking.findMany).mockResolvedValue([archivedBooking] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe(BookingStatus.ARCHIVED);
  });
});

describe("bookingComplianceReport — trend axis labels (timezone)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
    vi.mocked(db.booking.count).mockResolvedValue(0 as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  it("labels daily trend buckets in the acting user's timezone, not UTC", async () => {
    // why: The trend buckets are anchored to `timeframe.from`, which is
    // midnight in the user's pref timezone. For a Tokyo (UTC+9) user, the
    // first bucket starts at 2026-07-17T00:00 Tokyo = 2026-07-16T15:00Z.
    // Reading the bucket day in UTC yields "Thu 16" (off-by-one); reading it
    // in Asia/Tokyo yields the correct "Fri 17". A <=14-day span forces daily
    // granularity so `formatDayLabel` is exercised. Fixed UTC instants +
    // explicit timeZone keep the assertion machine-timezone independent.
    const timeframe: ResolvedTimeframe = {
      preset: "last_7d",
      label: "Last 7 days",
      // Tokyo midnight on 2026-07-17 and 2026-07-19 respectively.
      from: new Date("2026-07-16T15:00:00Z"),
      to: new Date("2026-07-18T14:59:59Z"),
    };

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe,
      timeZone: "Asia/Tokyo",
    });

    const labels = result.complianceTrend!.map((point) => point.label);
    expect(labels).toEqual(["Fri 17", "Sat 18"]);
    // Guard against the UTC off-by-one regression explicitly.
    expect(labels).not.toContain("Thu 16");
  });

  it("falls back to UTC labels when no timezone is provided", async () => {
    // why: With no resolved prefs the helper defaults to UTC, preserving the
    // historical behavior — the same Tokyo-anchored instants read one day
    // earlier in UTC.
    const timeframe: ResolvedTimeframe = {
      preset: "last_7d",
      label: "Last 7 days",
      from: new Date("2026-07-16T15:00:00Z"),
      to: new Date("2026-07-18T14:59:59Z"),
    };

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe,
    });

    const labels = result.complianceTrend!.map((point) => point.label);
    expect(labels).toEqual(["Thu 16", "Fri 17"]);
  });
});

describe("bookingComplianceReport — rewritten `to` (overdue check-in)", () => {
  beforeEach(() => {
    // why: `clearAllMocks` resets call history but LEAVES implementations
    // installed, so without these defaults a test that forgets one mock
    // silently inherits the previous describe's dataset and can pass for the
    // wrong reason. Every block in this file seeds all four.
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
    // why: the KPI block runs two `booking.count` calls that are irrelevant
    // to these scenarios; zero keeps the hero math driven by findMany alone.
    vi.mocked(db.booking.count).mockResolvedValue(0 as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([] as any);
    // why: `bookingStatusTransitionCounts` issues `db.$queryRaw` for the
    // chart series; an empty array decouples these tests from chart math.
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  it("counts a late return checked in from OVERDUE as late (check-in rewrote `to`)", async () => {
    // Checking in an OVERDUE booking rewrites `to` to the check-in moment and
    // preserves the planned end in `originalTo`. The hero must measure such
    // bookings against `originalTo`, or every resolved late return reads
    // on-time and the rate inflates toward 100%.
    const plannedEnd = new Date("2026-04-15T12:00:00Z");
    const returnMoment = new Date("2026-04-18T12:00:00Z"); // 3 days late

    const rewrittenBooking = makeComplianceBooking({
      id: "booking-rewritten",
      name: "Late Return",
      to: returnMoment,
      originalTo: plannedEnd,
    });

    vi.mocked(db.booking.findMany).mockResolvedValue([rewrittenBooking] as any);

    // Canonical check-in event at the rewritten `to` — exactly what the
    // overdue check-in flow produces.
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-rewritten", occurredAt: returnMoment },
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData!.onTime).toBe(0);
    expect(result.complianceData!.late).toBe(1);
    expect(result.complianceData!.rate).toBe(0);
  });

  it("keeps a booking in its own period and shows the planned end after the rewrite", async () => {
    // Due April 28, returned May 2: the rewrite moves `to` outside April.
    // The window filter must read the planned end (originalTo ?? to) or the
    // booking escapes the April report, and the row must display the planned
    // end, not the return moment.
    const plannedEnd = new Date("2026-04-28T12:00:00Z");
    const returnMoment = new Date("2026-05-02T09:00:00Z");

    const escapedBooking = makeComplianceBooking({
      id: "booking-escaped",
      name: "Returned After Window",
      from: new Date("2026-04-20T12:00:00Z"),
      to: returnMoment,
      originalTo: plannedEnd,
    });

    vi.mocked(db.booking.findMany).mockResolvedValue([escapedBooking] as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-escaped", occurredAt: returnMoment },
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    // Every booking query in the flow filters on the planned end: the
    // OR-fragment replaces a bare `to` range so rewritten bookings stay in
    // their own period (legacy rows with null originalTo fall back to `to`).
    // The prior-period query uses its own shifted window, so the shape is
    // asserted for every call and the exact dates for the main window only.
    const findManyCalls = vi.mocked(db.booking.findMany).mock.calls;
    expect(findManyCalls.length).toBeGreaterThan(0);
    for (const [args] of findManyCalls) {
      const where = (args as any).where;
      expect(where.to).toBeUndefined();
      expect(where.OR).toEqual([
        { originalTo: { gte: expect.any(Date), lte: expect.any(Date) } },
        {
          originalTo: null,
          to: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      ]);
    }
    expect((findManyCalls[0][0] as any).where.OR).toEqual([
      { originalTo: { gte: TIMEFRAME.from, lte: TIMEFRAME.to } },
      { originalTo: null, to: { gte: TIMEFRAME.from, lte: TIMEFRAME.to } },
    ]);

    // 4 days late against the planned end; the row shows the planned end.
    expect(result.complianceData!.late).toBe(1);
    expect(result.rows[0].scheduledEnd).toEqual(plannedEnd);
  });

  it("still counts a late return that was extended before it came back", async () => {
    // Extending a booking moves `to` and leaves `originalTo` on the deadline
    // that was agreed, so the return is measured against the plan. Without
    // this, extending a late booking clears it from the report — the metric
    // would be resettable by the person it measures.
    const plannedEnd = new Date("2026-04-10T12:00:00Z");
    const extendedTo = new Date("2026-04-20T12:00:00Z");

    vi.mocked(db.booking.findMany).mockResolvedValue([
      makeComplianceBooking({
        id: "booking-extended",
        name: "Extended Then Returned",
        to: extendedTo,
        originalTo: plannedEnd,
      }),
    ] as any);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "booking-extended", occurredAt: extendedTo },
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.complianceData!.late).toBe(1);
    expect(result.complianceData!.onTime).toBe(0);
    expect(result.rows[0].latenessMs).toBe(10 * 24 * 60 * 60 * 1000);
    expect(result.rows[0].scheduledEnd).toEqual(plannedEnd);
  });

  it("shows the planned start after an early check-out rewrote `from`", async () => {
    // The mirror of the end-date rewrite: checking out early with the
    // adjust-date intent moves `from` to the actual check-out moment and
    // leaves the planned start in `originalFrom`. A column labelled
    // "scheduled" must show what was scheduled.
    const plannedStart = new Date("2026-04-10T09:00:00Z");
    const checkoutMoment = new Date("2026-04-12T09:00:00Z");

    vi.mocked(db.booking.findMany).mockResolvedValue([
      makeComplianceBooking({
        id: "booking-early-checkout",
        name: "Early Checkout",
        from: checkoutMoment,
        originalFrom: plannedStart,
      }),
    ] as any);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].scheduledStart).toEqual(plannedStart);
  });
});
