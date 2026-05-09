# Fix Booking Compliance Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Booking Compliance report so the hero metrics include OVERDUE and ARCHIVED bookings, and so lateness on overdue rows reflects current time. Centralize all booking lateness/overdue calculation in one helper.

**Architecture:** Create a single `getLatenessMs` / `isOnTime` helper in `app/modules/booking/lateness.ts` that takes a booking-shaped input and (optionally) a check-in timestamp resolved from `ActivityEvent`. Use it from both the booking detail page (`time-remaining.tsx`) and every compliance computation in `app/modules/reports/helpers.server.ts`. Broaden the report's status filter from `["COMPLETE", "OVERDUE"]` to `["COMPLETE", "OVERDUE", "ARCHIVED"]` and resolve check-in time per booking using the `BOOKING_STATUS_CHANGED → COMPLETE` event. For OVERDUE rows, lateness is `now − to`; for COMPLETE/ARCHIVED rows, lateness is `checkInAt − to` (with `updatedAt` as legacy fallback).

**Tech Stack:** Remix, Prisma, Vitest, TypeScript. New code lives in the existing `@shelf/webapp` app — no new packages or migrations.

---

## Background

### Bug 1 — Hero metrics drop OVERDUE bookings

`computeComplianceRate()` (`apps/webapp/app/modules/reports/helpers.server.ts:531-599`) only fetches `status: "COMPLETE"`, so OVERDUE rows shown in the table are invisible to the hero `On-time / Late / Total` block. `computeCustodianPerformance()` and the KPI helper `computeBookingComplianceKpis()` have the same bug. Only `computeComplianceTrend()` already includes OVERDUE in its where clause.

### Bug 2 — Lateness frozen at the moment of OVERDUE transition

`fetchBookingComplianceRows()` computes `latenessMs = updatedAt − to` (`helpers.server.ts:403-406`). For OVERDUE bookings, `updatedAt` is set when the worker auto-transitioned the row to OVERDUE (`worker.server.ts:146`) and never updates again, so the displayed lateness stops growing. The booking detail page at `components/booking/time-remaining.tsx:31-37` correctly uses `now − to`. The two implementations have drifted.

### ARCHIVED bookings should count too

`archiveBooking()` requires `status === COMPLETE` (`service.server.ts:2452-2459`), confirmed. Once archived, the row's `updatedAt` shifts to the archive moment, so `updatedAt − to` is wildly inflated for ARCHIVED rows. We need a different signal for the actual check-in time.

The canonical signal is `ActivityEvent` with `action: "BOOKING_STATUS_CHANGED"`, `entityId: bookingId`, `toValue: "COMPLETE"`. This was added 2026-04-21 (`1f786f863`) — bookings completed before that date won't have the event and we fall back to "no data → assume on-time" semantics.

### Files involved

```text
apps/webapp/app/modules/booking/
  lateness.ts                    NEW   helper module (getLatenessMs, isOnTime, constants)
  lateness.test.ts               NEW   unit tests for the helper
  service.server.ts              read-only — references for canonical event shape
  worker.server.ts               read-only — confirms OVERDUE auto-transition

apps/webapp/app/modules/reports/
  helpers.server.ts              MODIFY all compliance compute paths
  check-in-time.server.ts        NEW   resolves check-in timestamp from ActivityEvent
  check-in-time.server.test.ts   NEW   unit tests for the resolver

apps/webapp/app/components/booking/
  time-remaining.tsx             MODIFY use lateness helper for OVERDUE display

apps/webapp/app/components/reports/
  compliance-hero.tsx            MODIFY explainer text mentions overdue/archived

apps/webapp/app/routes/_layout+/
  reports.$reportId.tsx          read-only — formatLateness already correct
```

---

## Task 1: Create the lateness helper module + tests

**Files:**

- Create: `apps/webapp/app/modules/booking/lateness.ts`
- Create: `apps/webapp/app/modules/booking/lateness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/webapp/app/modules/booking/lateness.test.ts`:

```typescript
import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_GRACE_PERIOD_MS,
  MEASURABLE_BOOKING_STATUSES,
  formatOverdueDuration,
  getLatenessMs,
  isOnTime,
} from "./lateness";

const due = new Date("2026-04-01T12:00:00Z");
const now = new Date("2026-04-30T12:00:00Z"); // 29 days after due

describe("getLatenessMs", () => {
  it("returns now - to for OVERDUE bookings", () => {
    const ms = getLatenessMs({
      status: BookingStatus.OVERDUE,
      to: due,
      checkInAt: null,
      now,
    });
    expect(ms).toBe(29 * 24 * 60 * 60 * 1000);
  });

  it("uses checkInAt - to for COMPLETE bookings", () => {
    const checkInAt = new Date(due.getTime() + 60 * 60 * 1000); // 1h late
    const ms = getLatenessMs({
      status: BookingStatus.COMPLETE,
      to: due,
      checkInAt,
      now,
    });
    expect(ms).toBe(60 * 60 * 1000);
  });

  it("uses checkInAt - to for ARCHIVED bookings (not updatedAt)", () => {
    const checkInAt = new Date(due.getTime() + 5 * 60 * 1000); // 5m late
    const ms = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      to: due,
      checkInAt,
      now,
    });
    expect(ms).toBe(5 * 60 * 1000);
  });

  it("returns null for COMPLETE without checkInAt (no signal)", () => {
    const ms = getLatenessMs({
      status: BookingStatus.COMPLETE,
      to: due,
      checkInAt: null,
      now,
    });
    expect(ms).toBeNull();
  });

  it("returns null for ARCHIVED without checkInAt", () => {
    const ms = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      to: due,
      checkInAt: null,
      now,
    });
    expect(ms).toBeNull();
  });

  it("returns null for non-measurable statuses", () => {
    for (const status of [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.CANCELLED,
    ] as const) {
      expect(
        getLatenessMs({ status, to: due, checkInAt: null, now })
      ).toBeNull();
    }
  });

  it("returns null when to is missing", () => {
    const ms = getLatenessMs({
      status: BookingStatus.OVERDUE,
      to: null,
      checkInAt: null,
      now,
    });
    expect(ms).toBeNull();
  });
});

describe("isOnTime", () => {
  it("returns true when lateness is within grace period", () => {
    expect(
      isOnTime({
        status: BookingStatus.COMPLETE,
        latenessMs: COMPLIANCE_GRACE_PERIOD_MS,
      })
    ).toBe(true);
  });

  it("returns false when lateness exceeds grace period", () => {
    expect(
      isOnTime({
        status: BookingStatus.COMPLETE,
        latenessMs: COMPLIANCE_GRACE_PERIOD_MS + 1,
      })
    ).toBe(false);
  });

  it("returns false for OVERDUE regardless of latenessMs", () => {
    expect(isOnTime({ status: BookingStatus.OVERDUE, latenessMs: 0 })).toBe(
      false
    );
  });

  it("returns true when latenessMs is null (no data — assume on-time)", () => {
    expect(isOnTime({ status: BookingStatus.COMPLETE, latenessMs: null })).toBe(
      true
    );
  });

  it("returns true for negative lateness (returned early)", () => {
    expect(
      isOnTime({ status: BookingStatus.ARCHIVED, latenessMs: -3600_000 })
    ).toBe(true);
  });
});

describe("formatOverdueDuration", () => {
  it("formats days, hours, and minutes", () => {
    const ms = 26 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000 + 11 * 60 * 1000;
    expect(formatOverdueDuration(ms)).toEqual({
      days: 26,
      hours: 14,
      minutes: 11,
    });
  });

  it("returns zeros for ms <= 0", () => {
    expect(formatOverdueDuration(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(formatOverdueDuration(-1000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
    });
  });
});

describe("MEASURABLE_BOOKING_STATUSES", () => {
  it("includes COMPLETE, OVERDUE, ARCHIVED", () => {
    expect(MEASURABLE_BOOKING_STATUSES).toEqual(
      expect.arrayContaining([
        BookingStatus.COMPLETE,
        BookingStatus.OVERDUE,
        BookingStatus.ARCHIVED,
      ])
    );
    expect(MEASURABLE_BOOKING_STATUSES).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm webapp:test -- --run app/modules/booking/lateness.test.ts`
Expected: FAIL with "Cannot find module './lateness'"

- [ ] **Step 3: Implement the helper**

Create `apps/webapp/app/modules/booking/lateness.ts`:

```typescript
/**
 * Booking Lateness / Overdue Helpers
 *
 * Single source of truth for "how late was a booking?" calculations.
 * Used by the Booking detail page (TimeRemaining) and the Booking
 * Compliance report. Keep this module small, pure, and dependency-free
 * so it can be safely imported from both server and client code.
 *
 * @see {@link file://./../../components/booking/time-remaining.tsx}
 * @see {@link file://./../reports/helpers.server.ts}
 */

import { BookingStatus } from "@prisma/client";

/**
 * Grace period for on-time returns: 15 minutes after scheduled end time.
 * A booking is considered "on-time" if returned within this window.
 */
export const COMPLIANCE_GRACE_PERIOD_MS = 15 * 60 * 1000;

/**
 * Booking statuses that contribute to compliance metrics.
 *
 * - COMPLETE: returned on or after the due date (lateness = checkIn − to).
 * - OVERDUE: still not returned (lateness = now − to, growing).
 * - ARCHIVED: completed first, then archived (lateness = checkIn − to,
 *   read from the BOOKING_STATUS_CHANGED → COMPLETE event timestamp).
 */
export const MEASURABLE_BOOKING_STATUSES = [
  BookingStatus.COMPLETE,
  BookingStatus.OVERDUE,
  BookingStatus.ARCHIVED,
] as const;

export type MeasurableBookingStatus =
  (typeof MEASURABLE_BOOKING_STATUSES)[number];

/** Arguments for {@link getLatenessMs}. */
export interface GetLatenessMsArgs {
  /** Current booking status. */
  status: BookingStatus;
  /** Scheduled end of the booking (`booking.to`). */
  to: Date | null;
  /**
   * Resolved check-in timestamp for COMPLETE/ARCHIVED bookings.
   * For OVERDUE bookings this is ignored — we use `now`.
   * Pass `null` if no check-in event was recorded (legacy data).
   */
  checkInAt: Date | null;
  /** "Now" — injectable for testing. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Compute lateness in milliseconds for a measurable booking.
 *
 * - OVERDUE: `now − to` (the booking is still late and growing).
 * - COMPLETE/ARCHIVED with `checkInAt`: `checkInAt − to`.
 * - COMPLETE/ARCHIVED without `checkInAt`: `null` (no data — caller
 *   should treat as on-time per {@link isOnTime}).
 * - Any other status, or missing `to`: `null`.
 *
 * Positive return = late, negative = early.
 */
export function getLatenessMs({
  status,
  to,
  checkInAt,
  now = new Date(),
}: GetLatenessMsArgs): number | null {
  if (!to) return null;

  if (status === BookingStatus.OVERDUE) {
    return now.getTime() - to.getTime();
  }

  if (status === BookingStatus.COMPLETE || status === BookingStatus.ARCHIVED) {
    if (!checkInAt) return null;
    return checkInAt.getTime() - to.getTime();
  }

  return null;
}

/** Arguments for {@link isOnTime}. */
export interface IsOnTimeArgs {
  status: BookingStatus;
  latenessMs: number | null;
}

/**
 * Decide whether a booking is "on-time" for compliance.
 *
 * - OVERDUE: never on-time.
 * - latenessMs null: no data — assume on-time (matches existing behavior).
 * - latenessMs <= grace period: on-time.
 */
export function isOnTime({ status, latenessMs }: IsOnTimeArgs): boolean {
  if (status === BookingStatus.OVERDUE) return false;
  if (latenessMs === null) return true;
  return latenessMs <= COMPLIANCE_GRACE_PERIOD_MS;
}

/**
 * Break a positive duration in milliseconds into days/hours/minutes.
 * Negative or zero input returns all zeros.
 *
 * Used by both the booking detail page and the report row formatter.
 */
export function formatOverdueDuration(ms: number): {
  days: number;
  hours: number;
  minutes: number;
} {
  if (ms <= 0) return { days: 0, hours: 0, minutes: 0 };
  const ONE_MINUTE = 60 * 1000;
  const ONE_HOUR = 60 * ONE_MINUTE;
  const ONE_DAY = 24 * ONE_HOUR;
  const days = Math.floor(ms / ONE_DAY);
  const hours = Math.floor((ms % ONE_DAY) / ONE_HOUR);
  const minutes = Math.floor((ms % ONE_HOUR) / ONE_MINUTE);
  return { days, hours, minutes };
}
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `pnpm webapp:test -- --run app/modules/booking/lateness.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/app/modules/booking/lateness.ts apps/webapp/app/modules/booking/lateness.test.ts
git commit -m "feat(booking): add centralized lateness helper for compliance reasoning"
```

---

## Task 2: Use the helper in the booking detail page

**Files:**

- Modify: `apps/webapp/app/components/booking/time-remaining.tsx:14-65`

- [ ] **Step 1: Update `time-remaining.tsx` to call the helper for the OVERDUE branch**

Replace the OVERDUE branch (currently lines 34-65) so it uses `getLatenessMs` and `formatOverdueDuration`:

```tsx
import { BookingStatus } from "@prisma/client";
import { Clock } from "lucide-react";

import {
  formatOverdueDuration,
  getLatenessMs,
} from "~/modules/booking/lateness";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";

export function TimeRemaining({
  to,
  from,
  status,
}: {
  to: Date;
  from: Date;
  status: BookingStatus;
}) {
  const currentDate = new Date();

  if (
    status === BookingStatus.COMPLETE ||
    status === BookingStatus.ARCHIVED ||
    status === BookingStatus.CANCELLED
  ) {
    return null;
  }

  const isUpcoming =
    status === BookingStatus.DRAFT || status === BookingStatus.RESERVED;

  // OVERDUE: delegate to the central helper so the report and the
  // detail page can never disagree on "how overdue is this?"
  if (status === BookingStatus.OVERDUE) {
    const overdueMs =
      getLatenessMs({ status, to, checkInAt: null, now: currentDate }) ?? 0;
    const { days, hours, minutes } = formatOverdueDuration(overdueMs);
    return (
      <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
        <Clock className="mr-1 size-4 text-gray-400" />
        <span className="font-medium text-gray-900">
          Overdue by {days} days
        </span>
        {hours > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{hours} hours</span>
          </>
        )}
        {minutes > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{minutes} minutes</span>
          </>
        )}
      </div>
    );
  }

  // remaining time for DRAFT / RESERVED / ONGOING — unchanged
  const targetDate = isUpcoming ? from : to;
  const remainingMs = targetDate.getTime() - currentDate.getTime();
  if (remainingMs < 0) return null;

  const remainingDays = Math.floor(remainingMs / ONE_DAY);
  const remainingHours = Math.floor((remainingMs % ONE_DAY) / ONE_HOUR);
  const remainingMinutes = Math.floor((remainingMs % ONE_HOUR) / (1000 * 60));

  if (isUpcoming) {
    return (
      <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
        <Clock className="mr-1 size-4 text-gray-400" />
        <span className="font-medium text-gray-900">
          Starts in: {remainingDays} days
        </span>
        {remainingHours > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{remainingHours} hours</span>
          </>
        )}
        {remainingMinutes > 0 && (
          <>
            <span className="mx-1">·</span>
            <span>{remainingMinutes} minutes</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center text-sm text-gray-600 md:ml-4 [&_span]:whitespace-nowrap">
      <Clock className="mr-1 size-4 text-gray-400" />
      <span className="font-medium text-gray-900">{remainingDays} days</span>
      {remainingHours > 0 && (
        <>
          <span className="mx-1">·</span>
          <span>{remainingHours} hours</span>
        </>
      )}
      {remainingMinutes > 0 && (
        <>
          <span className="mx-1">·</span>
          <span>{remainingMinutes} minutes</span>
        </>
      )}
      <span className="ml-1">remaining</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm turbo typecheck --filter=@shelf/webapp && pnpm webapp:lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/app/components/booking/time-remaining.tsx
git commit -m "refactor(booking): use centralized lateness helper in TimeRemaining"
```

---

## Task 3: Build the check-in time resolver + tests

**Files:**

- Create: `apps/webapp/app/modules/reports/check-in-time.server.ts`
- Create: `apps/webapp/app/modules/reports/check-in-time.server.test.ts`

We need a way to find the actual check-in moment for a batch of COMPLETE / ARCHIVED bookings. The canonical source is `ActivityEvent` rows with `action: "BOOKING_STATUS_CHANGED"`, `toValue: "COMPLETE"`. We resolve them in a single batched query and return a `Map<bookingId, Date>`.

- [ ] **Step 1: Write the failing test**

Create `apps/webapp/app/modules/reports/check-in-time.server.test.ts`:

```typescript
import type { ActivityEvent } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { resolveCheckInTimes } from "./check-in-time.server";

// why: the resolver hits the DB; we mock the prisma client to keep the
// unit test fast and deterministic.
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: {
      findMany: vi.fn(),
    },
  },
}));

const mockedFindMany = vi.mocked(db.activityEvent.findMany);

describe("resolveCheckInTimes", () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
  });

  it("returns an empty map when given no booking ids", async () => {
    const result = await resolveCheckInTimes([]);
    expect(result.size).toBe(0);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });

  it("returns the latest BOOKING_STATUS_CHANGED → COMPLETE event per booking", async () => {
    const earlier = new Date("2026-04-01T10:00:00Z");
    const later = new Date("2026-04-15T10:00:00Z");

    mockedFindMany.mockResolvedValueOnce([
      // booking-1 has two events (e.g. went COMPLETE → OVERDUE → COMPLETE again);
      // we keep the latest.
      { bookingId: "booking-1", createdAt: earlier } as ActivityEvent,
      { bookingId: "booking-1", createdAt: later } as ActivityEvent,
      { bookingId: "booking-2", createdAt: earlier } as ActivityEvent,
    ]);

    const result = await resolveCheckInTimes(["booking-1", "booking-2"]);

    expect(result.get("booking-1")).toEqual(later);
    expect(result.get("booking-2")).toEqual(earlier);
    expect(result.size).toBe(2);

    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        action: "BOOKING_STATUS_CHANGED",
        toValue: "COMPLETE",
        bookingId: { in: ["booking-1", "booking-2"] },
      },
      select: { bookingId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

  it("omits bookings that have no recorded check-in event", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { bookingId: "booking-1", createdAt: new Date() } as ActivityEvent,
    ]);

    const result = await resolveCheckInTimes(["booking-1", "legacy-booking"]);

    expect(result.has("booking-1")).toBe(true);
    expect(result.has("legacy-booking")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm webapp:test -- --run app/modules/reports/check-in-time.server.test.ts`
Expected: FAIL with "Cannot find module './check-in-time.server'"

- [ ] **Step 3: Implement the resolver**

Create `apps/webapp/app/modules/reports/check-in-time.server.ts`:

```typescript
/**
 * Check-in Time Resolver
 *
 * Reports need the actual moment a booking was checked in to compute
 * "was this returned on time?" for COMPLETE and ARCHIVED bookings. The
 * row's `updatedAt` is unreliable: it shifts whenever the row changes
 * for any reason (auto-archive job, edits, status flips). The canonical
 * signal is the `BOOKING_STATUS_CHANGED → COMPLETE` ActivityEvent.
 *
 * For bookings completed before the ActivityEvent system was introduced
 * (2026-04-21), no event exists; callers should treat the missing entry
 * as "no data" and fall back to on-time per `isOnTime`.
 *
 * @see {@link file://./helpers.server.ts}
 * @see {@link file://./../booking/lateness.ts}
 */

import { db } from "~/database/db.server";

/**
 * Resolve the latest check-in moment for each given booking.
 *
 * Returns a Map keyed by bookingId. Missing keys mean "no recorded
 * check-in event" — callers must handle that as no-data.
 *
 * @param bookingIds - Booking IDs to resolve. Empty array returns an
 *   empty Map without hitting the database.
 */
export async function resolveCheckInTimes(
  bookingIds: string[]
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (bookingIds.length === 0) return result;

  // Order ascending so later events overwrite earlier ones in the loop.
  // (A booking can transition COMPLETE → OVERDUE → COMPLETE in rare
  // edge cases; we want the latest check-in.)
  const events = await db.activityEvent.findMany({
    where: {
      action: "BOOKING_STATUS_CHANGED",
      toValue: "COMPLETE",
      bookingId: { in: bookingIds },
    },
    select: { bookingId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  for (const event of events) {
    if (!event.bookingId) continue;
    result.set(event.bookingId, event.createdAt);
  }

  return result;
}
```

- [ ] **Step 4: Run the test — verify all pass**

Run: `pnpm webapp:test -- --run app/modules/reports/check-in-time.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/app/modules/reports/check-in-time.server.ts apps/webapp/app/modules/reports/check-in-time.server.test.ts
git commit -m "feat(reports): resolve canonical check-in time from ActivityEvent"
```

---

## Task 4: Refactor `computeComplianceRate` to include OVERDUE + ARCHIVED

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts:531-621`

- [ ] **Step 1: Replace the function and its `categorizeCompletions` helper**

Replace `computeComplianceRate()` and `categorizeCompletions()` in `helpers.server.ts` with the implementations below. Keep the module-local `isBookingOnTime` (lines 85-97) as-is for now — Task 6 removes it once nothing else uses it.

```typescript
import {
  MEASURABLE_BOOKING_STATUSES,
  getLatenessMs,
  isOnTime,
} from "~/modules/booking/lateness";
import { resolveCheckInTimes } from "./check-in-time.server";

// ... existing imports ...

/**
 * Calculate compliance rate for measurable bookings (COMPLETE, OVERDUE,
 * ARCHIVED) whose due date falls within the timeframe.
 *
 * - COMPLETE / ARCHIVED: on-time if checked in within the grace period
 *   of the scheduled end. Check-in time is the timestamp of the
 *   BOOKING_STATUS_CHANGED → COMPLETE ActivityEvent. Bookings without
 *   such an event (legacy data) fall back to "on-time" per `isOnTime`.
 * - OVERDUE: never on-time by definition (still not returned).
 */
async function computeComplianceRate(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<ComplianceData> {
  const measurableBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: { in: MEASURABLE_BOOKING_STATUSES as unknown as BookingStatus[] },
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: { id: true, to: true, status: true },
  });

  const checkInTimes = await resolveCheckInTimes(
    measurableBookings.map((b) => b.id)
  );

  const { onTime, late } = categorizeBookings(measurableBookings, checkInTimes);
  const total = onTime + late;
  const rate = total > 0 ? Math.round((onTime / total) * 100) : null;

  // Prior period — same shape as before
  const periodLength = timeframe.to.getTime() - timeframe.from.getTime();
  const priorFrom = new Date(timeframe.from.getTime() - periodLength);
  const priorTo = new Date(timeframe.from.getTime() - 1);

  const priorBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: { in: MEASURABLE_BOOKING_STATUSES as unknown as BookingStatus[] },
      to: { gte: priorFrom, lte: priorTo },
    },
    select: { id: true, to: true, status: true },
  });
  const priorCheckInTimes = await resolveCheckInTimes(
    priorBookings.map((b) => b.id)
  );
  const priorResults = categorizeBookings(priorBookings, priorCheckInTimes);
  const priorTotal = priorResults.onTime + priorResults.late;
  const priorRate =
    priorTotal > 0
      ? Math.round((priorResults.onTime / priorTotal) * 100)
      : null;

  const priorPeriod =
    rate !== null && priorRate !== null
      ? {
          rate: priorRate,
          delta: rate - priorRate,
          periodLabel: getPriorPeriodLabel(timeframe.preset),
          fromDate: priorFrom,
          toDate: priorTo,
        }
      : undefined;

  return { onTime, late, rate, priorPeriod };
}

/**
 * Categorize a batch of measurable bookings as on-time vs late using
 * the central lateness helper.
 *
 * @param bookings - Bookings with status, due date, and id.
 * @param checkInTimes - Map from bookingId → check-in timestamp (from
 *   the BOOKING_STATUS_CHANGED → COMPLETE event). Missing keys mean
 *   "no recorded check-in" and the helper treats them as on-time.
 */
function categorizeBookings(
  bookings: { id: string; to: Date | null; status: BookingStatus }[],
  checkInTimes: Map<string, Date>
): { onTime: number; late: number } {
  let onTime = 0;
  let late = 0;
  const now = new Date();

  for (const booking of bookings) {
    const latenessMs = getLatenessMs({
      status: booking.status,
      to: booking.to,
      checkInAt: checkInTimes.get(booking.id) ?? null,
      now,
    });
    if (isOnTime({ status: booking.status, latenessMs })) {
      onTime++;
    } else {
      late++;
    }
  }
  return { onTime, late };
}
```

Delete the old `categorizeCompletions` function (lines 605-621) — it's replaced by `categorizeBookings`.

- [ ] **Step 2: Add a focused test for the function**

Create `apps/webapp/app/modules/reports/helpers.server.test.ts` (if it doesn't already exist) and add a test that verifies OVERDUE and ARCHIVED rows count toward the metrics. Use the database mock pattern from `check-in-time.server.test.ts` to keep the test unit-scoped:

```typescript
// apps/webapp/app/modules/reports/helpers.server.test.ts
import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { bookingComplianceReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./timeframe";

// why: prisma is the only external dependency; mocking it lets us
// assert compliance arithmetic without standing up a database.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    activityEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

const timeframe: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

describe("bookingComplianceReport hero metrics", () => {
  beforeEach(() => {
    vi.mocked(db.booking.findMany).mockReset();
    vi.mocked(db.booking.count).mockReset().mockResolvedValue(0);
    vi.mocked(db.activityEvent.findMany).mockReset().mockResolvedValue([]);
  });

  it("counts OVERDUE bookings as late", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      {
        id: "b1",
        to: new Date("2026-04-15T12:00:00Z"),
        status: BookingStatus.COMPLETE,
      },
      {
        id: "b2",
        to: new Date("2026-04-20T12:00:00Z"),
        status: BookingStatus.OVERDUE,
      },
    ] as never);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe,
    });

    expect(result.complianceData).toEqual(
      expect.objectContaining({ onTime: 1, late: 1, rate: 50 })
    );
  });

  it("counts ARCHIVED bookings using their check-in event timestamp", async () => {
    const due = new Date("2026-04-15T12:00:00Z");
    const checkInOnTime = new Date(due.getTime() + 5 * 60 * 1000);

    vi.mocked(db.booking.findMany).mockResolvedValue([
      { id: "b1", to: due, status: BookingStatus.ARCHIVED },
    ] as never);
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      { bookingId: "b1", createdAt: checkInOnTime },
    ] as never);

    const result = await bookingComplianceReport({
      organizationId: "org-1",
      timeframe,
    });

    expect(result.complianceData).toEqual(
      expect.objectContaining({ onTime: 1, late: 0, rate: 100 })
    );
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm webapp:test -- --run app/modules/reports/helpers.server.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/app/modules/reports/helpers.server.ts apps/webapp/app/modules/reports/helpers.server.test.ts
git commit -m "fix(reports): include OVERDUE and ARCHIVED in compliance rate"
```

---

## Task 5: Refactor `computeCustodianPerformance` for the same fix

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts:763-840` (and beyond — the whole function body)

- [ ] **Step 1: Replace the function**

```typescript
async function computeCustodianPerformance(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<CustodianPerformanceData[]> {
  const measurableBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: { in: MEASURABLE_BOOKING_STATUSES as unknown as BookingStatus[] },
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: {
      id: true,
      to: true,
      status: true,
      custodianUserId: true,
      custodianUser: { select: { firstName: true, lastName: true } },
      custodianTeamMemberId: true,
      custodianTeamMember: { select: { name: true } },
    },
  });

  const checkInTimes = await resolveCheckInTimes(
    measurableBookings.map((b) => b.id)
  );

  const custodianMap = new Map<
    string,
    { name: string; onTime: number; late: number }
  >();
  const now = new Date();

  for (const booking of measurableBookings) {
    const key =
      booking.custodianUserId || booking.custodianTeamMemberId || "__none__";
    const name = booking.custodianUser
      ? stripNameSuffix(
          `${booking.custodianUser.firstName || ""} ${
            booking.custodianUser.lastName || ""
          }`.trim()
        )
      : booking.custodianTeamMember
        ? stripNameSuffix(booking.custodianTeamMember.name)
        : "No Custodian";

    if (!custodianMap.has(key)) {
      custodianMap.set(key, { name, onTime: 0, late: 0 });
    }
    const entry = custodianMap.get(key)!;
    const latenessMs = getLatenessMs({
      status: booking.status,
      to: booking.to,
      checkInAt: checkInTimes.get(booking.id) ?? null,
      now,
    });
    if (isOnTime({ status: booking.status, latenessMs })) {
      entry.onTime++;
    } else {
      entry.late++;
    }
  }

  const results: CustodianPerformanceData[] = [];
  for (const [key, data] of custodianMap) {
    const total = data.onTime + data.late;
    const rate = total > 0 ? Math.round((data.onTime / total) * 100) : 100;
    results.push({
      custodianId: key === "__none__" ? null : key,
      custodianName: data.name,
      onTime: data.onTime,
      late: data.late,
      total,
      rate,
    });
  }
  return results;
}
```

(Keep the existing trailing logic — sorting, slicing, etc. — exactly as it was; only the function body that builds `custodianMap` changed.)

- [ ] **Step 2: Typecheck**

Run: `pnpm turbo typecheck --filter=@shelf/webapp`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/webapp/app/modules/reports/helpers.server.ts
git commit -m "fix(reports): include OVERDUE and ARCHIVED in custodian performance"
```

---

## Task 6: Update `computeComplianceTrend` to include ARCHIVED + use helper

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts:651-740` (function body)

- [ ] **Step 1: Replace the trend function body**

The current function already includes OVERDUE in its where clause (correct) but uses the local `isBookingOnTime` and `updatedAt`. Replace with:

```typescript
async function computeComplianceTrend(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<ComplianceTrendPoint[]> {
  const periodMs = timeframe.to.getTime() - timeframe.from.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const msPerWeek = 7 * msPerDay;
  const periodDays = periodMs / msPerDay;
  const useDailyGranularity = periodDays <= 14;
  const bucketMs = useDailyGranularity ? msPerDay : msPerWeek;
  const numBuckets = Math.max(1, Math.ceil(periodMs / bucketMs));

  const measurableBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: { in: MEASURABLE_BOOKING_STATUSES as unknown as BookingStatus[] },
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: { id: true, to: true, status: true },
  });

  const checkInTimes = await resolveCheckInTimes(
    measurableBookings.map((b) => b.id)
  );

  const trend: ComplianceTrendPoint[] = [];
  const now = new Date();

  for (let i = 0; i < numBuckets; i++) {
    const bucketStart = new Date(timeframe.from.getTime() + i * bucketMs);
    const bucketEnd = new Date(
      Math.min(bucketStart.getTime() + bucketMs - 1, timeframe.to.getTime())
    );
    const bucketBookings = measurableBookings.filter((b) => {
      const dueDate = b.to?.getTime() ?? 0;
      return dueDate >= bucketStart.getTime() && dueDate <= bucketEnd.getTime();
    });

    let onTime = 0;
    let late = 0;
    for (const booking of bucketBookings) {
      const latenessMs = getLatenessMs({
        status: booking.status,
        to: booking.to,
        checkInAt: checkInTimes.get(booking.id) ?? null,
        now,
      });
      if (isOnTime({ status: booking.status, latenessMs })) onTime++;
      else late++;
    }
    const total = onTime + late;
    const rate = total > 0 ? Math.round((onTime / total) * 100) : null;

    const label = useDailyGranularity
      ? formatDayLabel(bucketStart)
      : numBuckets <= 4
        ? formatWeekLabel(bucketStart, bucketEnd)
        : formatWeekLabel(bucketStart, bucketEnd);

    trend.push({ label, rate, onTime, late, total });
  }

  return trend;
}
```

(`formatDayLabel` and `formatWeekLabel` already exist in the file — keep their definitions untouched.)

- [ ] **Step 2: Delete the now-unused module-local `isBookingOnTime`**

Once Tasks 4–6 are done, the local helper at `helpers.server.ts:78-97` has no callers. Delete it along with the local `COMPLIANCE_GRACE_PERIOD_MS` (lines 65-75). Both are now exported from `~/modules/booking/lateness`.

- [ ] **Step 3: Typecheck and run all reports tests**

Run: `pnpm turbo typecheck --filter=@shelf/webapp && pnpm webapp:test -- --run app/modules/reports`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/app/modules/reports/helpers.server.ts
git commit -m "fix(reports): use central lateness helper for compliance trend"
```

---

## Task 7: Broaden the table query + fix lateness column

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts:140-256` (`bookingComplianceReport`) and `:363-446` (`fetchBookingComplianceRows`)

The table currently filters to `status: { in: ["COMPLETE", "OVERDUE"] }`. We add ARCHIVED and switch the lateness calculation to the central helper, so the table count and the hero count match exactly.

- [ ] **Step 1: Update the report's base where clause and the row builder**

In `bookingComplianceReport()` (around line 162):

```typescript
const where: Prisma.BookingWhereInput = {
  organizationId,
  to: { gte: timeframe.from, lte: timeframe.to },
  status: { in: MEASURABLE_BOOKING_STATUSES as unknown as BookingStatus[] },
};

// existing statusFilter intersection logic — keep it but allow all measurable statuses
if (statusFilter && statusFilter.length > 0) {
  const measurableStatuses = statusFilter.filter((s) =>
    (MEASURABLE_BOOKING_STATUSES as readonly BookingStatus[]).includes(s)
  );
  if (measurableStatuses.length > 0) {
    where.status = { in: measurableStatuses as BookingStatus[] };
  }
}
```

In `fetchBookingComplianceRows()` (around line 372), after fetching `bookings`, resolve check-in times in one batched query and replace the `latenessMs = updatedAt − to` block:

```typescript
const checkInTimes = await resolveCheckInTimes(bookings.map((b) => b.id));
const now = new Date();

const allRows: BookingComplianceRow[] = bookings.map((b) => {
  const latenessMs = getLatenessMs({
    status: b.status,
    to: b.to,
    checkInAt: checkInTimes.get(b.id) ?? null,
    now,
  });

  return {
    id: b.id,
    bookingId: b.id,
    bookingName: b.name || `Booking ${b.id.slice(0, 8)}`,
    status: b.status,
    custodian: b.custodianUser
      ? stripNameSuffix(
          `${b.custodianUser.firstName || ""} ${
            b.custodianUser.lastName || ""
          }`.trim()
        )
      : b.custodianTeamMember
        ? stripNameSuffix(b.custodianTeamMember.name)
        : null,
    assetCount: b._count.assets,
    scheduledStart: b.from!,
    scheduledEnd: b.to!,
    actualCheckout: null,
    actualCheckin: checkInTimes.get(b.id) ?? null,
    isOnTime: isOnTime({ status: b.status, latenessMs }),
    isOverdue: b.status === BookingStatus.OVERDUE,
    latenessMs,
  };
});
```

You can drop the `updatedAt: true` line from the `select` if no longer used. Verify there are no other readers — if so, leave it.

- [ ] **Step 2: Add a row-level test**

Append to `helpers.server.test.ts`:

```typescript
it("computes lateness as now − to for OVERDUE rows", async () => {
  const fixedNow = new Date("2026-04-30T12:00:00Z");
  vi.useFakeTimers().setSystemTime(fixedNow);

  vi.mocked(db.booking.findMany).mockResolvedValue([
    {
      id: "b1",
      name: "Alexander Spence",
      status: BookingStatus.OVERDUE,
      from: new Date("2026-04-01T12:00:00Z"),
      to: new Date("2026-04-04T12:00:00Z"),
      updatedAt: new Date("2026-04-06T16:00:00Z"), // would give 2d4h late if used
      custodianUser: null,
      custodianTeamMember: null,
      _count: { assets: 6 },
    },
  ] as never);

  const result = await bookingComplianceReport({
    organizationId: "org-1",
    timeframe,
  });
  const row = result.rows[0];

  expect(row.latenessMs).toBe(26 * 24 * 60 * 60 * 1000); // ~26 days
  expect(row.isOverdue).toBe(true);

  vi.useRealTimers();
});

it("includes ARCHIVED rows in the table", async () => {
  vi.mocked(db.booking.findMany).mockResolvedValue([
    {
      id: "b1",
      name: "Old archived",
      status: BookingStatus.ARCHIVED,
      from: new Date("2026-04-01T12:00:00Z"),
      to: new Date("2026-04-15T12:00:00Z"),
      updatedAt: new Date("2026-05-15T12:00:00Z"),
      custodianUser: null,
      custodianTeamMember: null,
      _count: { assets: 1 },
    },
  ] as never);

  const result = await bookingComplianceReport({
    organizationId: "org-1",
    timeframe,
  });

  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].status).toBe(BookingStatus.ARCHIVED);
});
```

(`db.booking.findMany` is mocked once and returns the same array for both the rows fetch and the compliance-rate fetch in the same test — that's fine because each test asserts a different field of the result.)

- [ ] **Step 3: Run all the new tests**

Run: `pnpm webapp:test -- --run app/modules/reports app/modules/booking/lateness`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/app/modules/reports/helpers.server.ts apps/webapp/app/modules/reports/helpers.server.test.ts
git commit -m "fix(reports): show live lateness on OVERDUE rows and include ARCHIVED"
```

---

## Task 8: Fix the overdue KPI id so the PDF picks it up

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts:345` (the KPI id returned by `computeBookingComplianceKpis`)

**Why:** `routes/api+/reports.$reportId.generate-pdf.tsx:168-170` looks up
`kpis.find((k) => k.id === "currently_overdue")` and the type
`BookingComplianceKpiId` (`apps/webapp/app/modules/reports/types.ts:259`)
declares `"currently_overdue"` as the canonical id, but the implementation
emits `id: "overdue"`. The lookup silently returns `undefined`, so the PDF's
`overdueCount` is always `0`. The fix is renaming the id in the
implementation to match the type and the consumer.

- [ ] **Step 1: Rename the id**

In `helpers.server.ts`, find the KPI object that currently uses `id: "overdue"` (around line 345) and change the id to `"currently_overdue"`. The rest of the object (label, value, format, etc.) stays the same.

```typescript
{
  id: "currently_overdue",
  label: "Overdue",
  value: overdue.toLocaleString(),
  rawValue: overdue,
  format: "number",
  delta: null,
  deltaType: overdue > 0 ? "negative" : "positive",
},
```

- [ ] **Step 2: Search for any stale `"overdue"` string consumers**

Run: `grep -rn '"overdue"' apps/webapp/app | grep -v ".test."`
Expected: only the renamed line in `helpers.server.ts` (no other consumers
referenced the old id by string).

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo typecheck --filter=@shelf/webapp`
Expected: clean — the PDF route already imports the correct id via the
`BookingComplianceKpiId` type-driven path.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/app/modules/reports/helpers.server.ts
git commit -m "fix(reports): rename overdue KPI id to currently_overdue so PDF picks it up"
```

---

## Task 9: Refresh hero explainer copy

**Files:**

- Modify: `apps/webapp/app/components/reports/compliance-hero.tsx:163-173`

The current footer text reads "A booking is 'on-time' if checked in within 15 minutes of the scheduled end time." After this fix, OVERDUE bookings count as late and ARCHIVED bookings count too — say so.

- [ ] **Step 1: Update the explainer**

Replace the inner `<p>` block (lines 165-172) with:

```tsx
<p className="text-xs text-gray-400">
  <span className="font-medium text-gray-500">How it's calculated:</span>{" "}
  {onTime} on-time ÷ {total} total = {rate}% (rounded to nearest whole number).
  Bookings with a due date in this period are counted: completed and archived
  bookings are "on-time" if returned within 15 minutes of the scheduled end;
  overdue bookings always count as late.
</p>
```

- [ ] **Step 2: Lint + commit**

```bash
pnpm webapp:lint
git add apps/webapp/app/components/reports/compliance-hero.tsx
git commit -m "docs(reports): clarify compliance hero explainer for overdue and archived"
```

---

## Task 10: Validate end-to-end

- [ ] **Step 1: Run the full validation pipeline**

Run: `pnpm webapp:validate`
Expected: lint, typecheck, and all unit tests pass.

- [ ] **Step 2: Manual smoke test (the original user scenario)**

1. Start the dev server: `pnpm webapp:dev`.
2. Open `/reports/booking-compliance`.
3. With a workspace that has at least one OVERDUE booking and one COMPLETE booking due in the selected timeframe, confirm:
   - Hero shows the OVERDUE booking in the `Late` count and `Total`.
   - Compliance % is `onTime / (onTime + late)` and is no longer 100% when an overdue exists.
   - The OVERDUE row in the table displays a lateness duration that matches the booking detail page (`Overdue by N days · H hours · M minutes`).
4. Open the booking detail page for the same OVERDUE booking; the lateness shown by `TimeRemaining` matches the report row exactly.
5. If your workspace has an ARCHIVED booking with a due date in the timeframe, switch the timeframe so it's included and confirm the hero count and table both grew by 1.

- [ ] **Step 3: Stop dev server, kill any vitest processes**

(Per CLAUDE.md: never leave parallel test processes running.)

- [ ] **Step 4: Final commit if anything required tweaks**

If the manual test surfaced bugs, fix them in a separate commit per the standard workflow — do not amend.

---

## Self-review checklist (run after writing all code)

- [ ] **Spec coverage:** Both bugs from the screenshots are addressed (Task 4 + Task 7). Centralized helper exists (Task 1). Helper used on the booking page (Task 2). ARCHIVED included (Tasks 4–7).
- [ ] **No dead code:** The local `isBookingOnTime` and `COMPLIANCE_GRACE_PERIOD_MS` in `helpers.server.ts` are deleted in Task 6.
- [ ] **No dual sources of truth:** `getLatenessMs` is the only place that decides `now − to` vs `checkInAt − to`.
- [ ] **Type consistency:** `MEASURABLE_BOOKING_STATUSES` is exported as a tuple of `BookingStatus` and consumed via `as unknown as BookingStatus[]` in Prisma `where` clauses (matches existing patterns in the file).
- [ ] **PDF KPI id mismatch fixed (Task 8):** the renamed id `"currently_overdue"` makes the PDF's `overdueCount` work end-to-end.
