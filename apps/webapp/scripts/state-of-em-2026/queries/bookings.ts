/**
 * Bookings queries — "The booking problem" section.
 *
 * Produces (keys match website-v2 sectionStats.bookings):
 *
 *   avg_bookings_per_workspace_per_month            — mean Bookings per Org per calendar month over the window
 *   bk_median_bookings_per_workspace_per_year       — median Bookings per eligible Org over the window
 *   pct_bookings_with_conflict_averted              — % of attempted-create events blocked by conflict
 *   bk_median_lead_time_days                        — median (Booking.from - createdAt) in days
 *   bk_pct_overdue                                   — % of Bookings whose actualReturnAt > to (overdue)
 *   bk_median_overdue_hours                          — median lateness on overdue bookings
 *   bk_peak_day                                      — weekday name with the most Booking.from timestamps
 *
 * Cohort sub-filter: restrict to Organizations that have at least one
 * Booking in the window AND have the bookings feature in active use.
 * The website report flags this as a "workspaces with bookings enabled"
 * cohort — size it separately and apply k-anonymity to the sub-cohort.
 *
 * Conflict-averted query NOTE: this requires either
 * (a) an ActivityEvent row recording the failed attempt, or
 * (b) telemetry instrumentation at the API layer.
 * If neither exists today, this stat is `not_implemented` until the
 * data team decides whether to add the instrumentation or drop the stat.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runBookingsQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement against bookings-enabled subset of eligibleOrgIds.
    //
    // Implementation guidance:
    // - Restrict to Bookings with status IN (RESERVED, ONGOING, OVERDUE,
    //   COMPLETE, ARCHIVED, CANCELLED) within the window (Booking.from
    //   falls within window).
    // - Lead time: where Booking.createdAt < Booking.from, compute the
    //   difference. Bookings created retroactively (createdAt > from) are
    //   excluded as data-quality outliers.
    // - Overdue %: status = OVERDUE OR (status = COMPLETE AND actualReturnAt > to).
    //   Schema confirmation needed — whether actualReturnAt is a column or
    //   inferred from ActivityEvent.
    // - Peak day: groupBy day-of-week extracted from Booking.from. Use
    //   raw SQL (`EXTRACT(DOW FROM "from")` in Postgres) or compute in JS.
    // - Conflict-averted: see the NOTE above. Today this likely returns
    //   not_implemented until telemetry is in place.

    return {
        avg_bookings_per_workspace_per_month: notImplementedAggregate({
            key: "avg_bookings_per_workspace_per_month",
            label: "Average bookings per workspace per month",
        }),
        bk_median_bookings_per_workspace_per_year: notImplementedAggregate({
            key: "bk_median_bookings_per_workspace_per_year",
            label: "Median bookings per workspace per year",
        }),
        pct_bookings_with_conflict_averted: notImplementedAggregate({
            key: "pct_bookings_with_conflict_averted",
            label: "Of attempted bookings were blocked by Shelf for conflict",
            unit: "%",
        }),
        bk_median_lead_time_days: notImplementedAggregate({
            key: "bk_median_lead_time_days",
            label: "Median booking lead time",
            unit: " days",
        }),
        bk_pct_overdue: notImplementedAggregate({
            key: "bk_pct_overdue",
            label: "Of bookings ended after the scheduled return time",
            unit: "%",
        }),
        bk_median_overdue_hours: notImplementedAggregate({
            key: "bk_median_overdue_hours",
            label: "Median lateness on overdue bookings",
            unit: " hours",
        }),
        bk_peak_day: notImplementedAggregate({
            key: "bk_peak_day",
            label: "Most-booked weekday",
        }),
    };
}
