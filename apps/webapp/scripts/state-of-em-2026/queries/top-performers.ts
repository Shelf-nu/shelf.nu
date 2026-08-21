/**
 * Top-performer patterns — "What top performers do differently" section.
 *
 * Segments the eligible cohort into top-quartile workspaces and identifies
 * the behavioral patterns that distinguish them from median peers.
 *
 * Top-quartile definition: workspaces whose Missing rate is in the bottom
 * quartile AND on-time return rate is in the top quartile (i.e. the
 * workspaces that lose the fewest assets and return the most bookings on
 * time). Apply k-anonymity to the top-quartile sub-cohort.
 *
 * Produces (keys match website-v2 topPerformerPatterns):
 *   early_custody_assignment   — quantified delta in missing rate
 *   quarterly_audit_cadence    — quantified delta in ghost-asset rate
 *   qr_labels_at_intake        — quantified delta in custody coverage
 *   kit_grouping               — quantified delta in missing-accessory rate
 *
 * These are CORRELATIONS not causal claims. The report copy is careful
 * about this; the query output should be too.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runTopPerformerQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement.
    //
    // Implementation guidance:
    // - First, score each workspace on missing-rate and on-time-return-rate.
    //   Take the intersection of bottom-quartile-missing AND top-quartile-
    //   on-time; that's the top performer cohort.
    // - For each pattern, compute the median value of the relevant metric
    //   within the top cohort vs the rest of the eligible cohort.
    //   Report the delta (e.g. "X percentage points lower missing rate").
    // - Patterns to measure:
    //     1. Early-custody-assignment: time from Asset.createdAt to first
    //        custody-related ActivityEvent. Top performers vs rest, median.
    //     2. Quarterly audit cadence: count of completed audits per year
    //        per workspace. Top performers vs rest, median.
    //     3. QR labels at intake: % of Assets that have a QR association
    //        record within 7 days of Asset.createdAt. Top vs rest.
    //     4. Kit grouping: median ratio of Kit count to component-asset
    //        count for kit-using workspaces. Top vs rest.
    // - Each metric needs its own k-anonymity check because the top-
    //   quartile sub-cohort may shrink the eligible N significantly.

    return {
        tp_early_custody_assignment_delta: notImplementedAggregate({
            key: "tp_early_custody_assignment_delta",
            label: "Top performers: median delta in missing rate from assigning custody within 48h",
            unit: " percentage points",
        }),
        tp_quarterly_audit_cadence_delta: notImplementedAggregate({
            key: "tp_quarterly_audit_cadence_delta",
            label: "Top performers: median delta in ghost-asset rate from quarterly audit cadence",
            unit: " percentage points",
        }),
        tp_qr_labels_at_intake_delta: notImplementedAggregate({
            key: "tp_qr_labels_at_intake_delta",
            label: "Top performers: median delta in custody coverage from labeling at intake",
            unit: " percentage points",
        }),
        tp_kit_grouping_delta: notImplementedAggregate({
            key: "tp_kit_grouping_delta",
            label: "Top performers: median delta in missing-accessory rate from kit grouping",
            unit: " percentage points",
        }),
    };
}
