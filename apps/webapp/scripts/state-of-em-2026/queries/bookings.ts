/**
 * Bookings queries — un-deferred in v1.2 for one stat: `bk_pct_returned_late`.
 *
 * v1.0 of this file emitted seven booking stats. v1.1 deferred the entire
 * file as out-of-scope for the trimmed-to-eight headline structure. v1.2
 * brings back the late-return rate because it pairs with the new idle-asset
 * headline: idle assets are "dead capital" and late returns are "cascade
 * friction" — they're the two faces of the same operational problem in the
 * report.
 *
 * Produces:
 *   bk_pct_returned_late  — % of bookings whose return time exceeded `to`
 *                           among workspaces that used bookings in window
 *
 * Cohort sub-filter: restrict to Organizations that have at least one
 * non-DRAFT Booking with `from` inside the data window. The probe at
 * ../probe.ts measures this rate before queries run; if it drops below the
 * `bookingsActiveMin` threshold (10%), the website MDX drops the late-
 * return section entirely.
 *
 * The six other stats from v1.0 (avg bookings per month, conflict averted,
 * lead time, overdue hours, peak day) remain deferred. Their stubs live in
 * git history; restore in 2027 if the editorial team wants them back.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runBookingsQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement.
    //
    // ---------------------------------------------------------------
    // bk_pct_returned_late
    // ---------------------------------------------------------------
    // Definition (matches website MDX):
    //   A booking is "returned late" if either:
    //     (a) status IN ('COMPLETE', 'ARCHIVED') AND the BOOKING_CHECKED_IN
    //         ActivityEvent for the booking has occurredAt > Booking.to, OR
    //     (b) status IN ('ONGOING', 'OVERDUE') AND NOW() > Booking.to (still
    //         out past the scheduled return)
    //
    // The Booking model itself does not carry an `actualReturnAt` column, so
    // determining the actual check-in timestamp requires reading the
    // ActivityEvent log. The most efficient approach is a single raw SQL
    // query joining Booking → ActivityEvent on bookingId and action =
    // 'BOOKING_CHECKED_IN', taking the MAX(occurredAt) per booking.
    //
    //   WITH window_bookings AS (
    //     SELECT id, "organizationId", status, "to"
    //     FROM "Booking"
    //     WHERE "organizationId" = ANY($eligibleOrgIds)
    //       AND "from" >= $dataWindowStart
    //       AND "from" <= $dataWindowEnd
    //       AND status NOT IN ('DRAFT', 'CANCELLED')
    //   ),
    //   checked_in AS (
    //     SELECT "bookingId", MAX("occurredAt") AS checked_in_at
    //     FROM "ActivityEvent"
    //     WHERE "bookingId" IS NOT NULL
    //       AND action = 'BOOKING_CHECKED_IN'
    //     GROUP BY "bookingId"
    //   )
    //   SELECT COUNT(*) FILTER (WHERE
    //     (wb.status IN ('COMPLETE', 'ARCHIVED') AND ci.checked_in_at > wb."to")
    //     OR (wb.status IN ('ONGOING', 'OVERDUE') AND NOW() > wb."to")
    //   ) AS late_count,
    //   COUNT(*) AS total_count
    //   FROM window_bookings wb
    //   LEFT JOIN checked_in ci ON ci."bookingId" = wb.id;
    //
    // value      = late_count / total_count * 100
    // cohortSize = distinct organization count contributing to window_bookings
    //              (apply k-anonymity to this sub-cohort, not the global one)
    //
    // Wrap the result with reportable({ ... }) — do NOT build a
    // ReportableAggregate directly.

    return {
        bk_pct_returned_late: notImplementedAggregate({
            key: "bk_pct_returned_late",
            label: "Of bookings ended after the scheduled return time (booking-using subset)",
            unit: "%",
        }),
    };
}
