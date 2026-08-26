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
    // why: the overdue and distribution suites below drive reports that read
    // assets, categories and locations; declaring the members here keeps one
    // shared client mock.
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    location: {
      count: vi.fn(),
    },
    // why: `bookingStatusTransitionCounts` issues `db.$queryRaw` for the
    // chart series. We stub it to a resolved empty array so the hero-data
    // path is not coupled to chart math.
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";

import {
  assetDistributionReport,
  bookingComplianceReport,
  overdueItemsReport,
} from "./helpers.server";
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
      {
        id: "booking-no-event",
        name: "Partial Check-in",
        status: "COMPLETE",
        from: new Date("2026-04-14T12:00:00Z"),
        to: dueDate,
        updatedAt,
        custodianUser: null,
        custodianTeamMember: null,
        custodianUserId: null,
        custodianTeamMemberId: null,
        _count: { assets: 1 },
      },
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
      {
        id: "booking-archived-no-event",
        name: "Legacy Archived",
        status: "ARCHIVED",
        from: new Date("2026-04-14T12:00:00Z"),
        to: dueDate,
        // 10 days after due date — would mark as very late if fallback applied.
        updatedAt: new Date(dueDate.getTime() + 10 * 24 * 60 * 60 * 1000),
        custodianUser: null,
        custodianTeamMember: null,
        custodianUserId: null,
        custodianTeamMemberId: null,
        _count: { assets: 1 },
      },
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

describe("overdueItemsReport — booked-unit value math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // why: the KPI helper and row fetch both read booking.findMany; count
    // feeds totalRows only.
    vi.mocked(db.booking.count).mockResolvedValue(1 as any);
  });

  it("multiplies row value-at-risk by BookingAsset.quantity", async () => {
    // One overdue booking holding 5 units of a $100 asset: the exposure is
    // $500 on the row and the CSV, exactly as the hero KPI computes it.
    const overdueBooking = {
      id: "booking-qt",
      name: "QT Overdue",
      to: new Date("2026-04-10T12:00:00Z"),
      custodianUserId: null,
      custodianUser: null,
      custodianTeamMember: null,
      bookingAssets: [
        {
          quantity: 5,
          asset: { id: "asset-1", valuation: 100 },
        },
      ],
      partialCheckins: [],
      _count: { bookingAssets: 1 },
    };
    vi.mocked(db.booking.findMany).mockResolvedValue([overdueBooking] as any);

    const result = await overdueItemsReport({ organizationId: "org-1" });

    expect(result.rows[0].valueAtRisk).toBe(500);
    const vaRKpi = result.kpis.find((k) => k.id === "total_value_at_risk");
    expect(vaRKpi?.rawValue).toBe(500);
  });
});

describe("assetDistributionReport — quantity-aware bucket values", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // why: the headline Total Value KPI runs a raw SQL sum plus asset,
    // category and location counts; fixed results keep the KPIs stable while
    // the buckets under test read asset.findMany.
    vi.mocked(db.$queryRaw).mockResolvedValue([{ total: 57 }] as any);
    vi.mocked(db.asset.count).mockResolvedValue(2 as any);
    vi.mocked(db.category.count).mockResolvedValue(1 as any);
    vi.mocked(db.location.count).mockResolvedValue(1 as any);
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", name: "Cameras" },
    ] as any);
  });

  it("sums category buckets as valuation × stock, matching the headline", async () => {
    // 10 units at $5 plus one individual $7 asset: the bucket must say $57,
    // the same arithmetic as the quantity-aware headline above it.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      {
        id: "a-qt",
        categoryId: "cat-1",
        status: "AVAILABLE",
        valuation: 5,
        quantity: 10,
        assetLocations: [],
      },
      {
        id: "a-ind",
        categoryId: "cat-1",
        status: "AVAILABLE",
        valuation: 7,
        quantity: null,
        assetLocations: [],
      },
    ] as any);

    const result = await assetDistributionReport({ organizationId: "org-1" });

    const catBucket = result.distributionBreakdown!.byCategory.find(
      (b) => b.id === "cat-1"
    );
    expect(catBucket?.totalValue).toBe(57);
    expect(catBucket?.assetCount).toBe(2);
    const statusBucket = result.distributionBreakdown!.byStatus.find(
      (b) => b.id === "AVAILABLE"
    );
    expect(statusBucket?.totalValue).toBe(57);
  });

  it("weights location buckets by units placed there; No Location means no placements at all", async () => {
    // 10 units at $5 with 6 placed at Warehouse: the bucket carries $30
    // (units there × unit value). The asset has placement rows, so it must
    // NOT appear under No Location — that slice drills down to the
    // `assetLocations: none` filter and has to describe exactly that
    // population. A second, fully unplaced asset lands there with its full
    // stock value.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      {
        id: "a-qt",
        categoryId: null,
        status: "AVAILABLE",
        valuation: 5,
        quantity: 10,
        assetLocations: [
          {
            quantity: 6,
            location: { id: "loc-1", name: "Warehouse" },
          },
        ],
      },
      {
        id: "a-unplaced",
        categoryId: null,
        status: "AVAILABLE",
        valuation: 4,
        quantity: 3,
        assetLocations: [],
      },
    ] as any);

    const result = await assetDistributionReport({ organizationId: "org-1" });

    const byLocation = result.distributionBreakdown!.byLocation;
    expect(byLocation.find((b) => b.id === "loc-1")?.totalValue).toBe(30);
    const noLocation = byLocation.find((b) => b.id === "without-location");
    expect(noLocation?.totalValue).toBe(12);
    expect(noLocation?.assetCount).toBe(1);
  });

  it("reads the asset table once for all three breakdowns", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([] as any);

    await assetDistributionReport({ organizationId: "org-1" });

    expect(vi.mocked(db.asset.findMany)).toHaveBeenCalledTimes(1);
  });
});
