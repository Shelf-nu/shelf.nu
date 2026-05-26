/**
 * Visibility queries — trimmed to the one stat that appears in the v1
 * published headline structure: pct_assets_with_active_custody.
 *
 * The original v0 stubs (median_assets_per_workspace, median_users_per_
 * workspace, vis_assets_with_location, vis_assets_with_category, etc.)
 * were cut from the published report per editorial review — they are
 * demographic noise that nobody outside Shelf would quote. They remain
 * in the git history for restoration in 2027 if useful.
 *
 * @see ../README.md — the trimmed-scope explanation
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runVisibilityQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement against the eligible cohort in _ctx.eligibleOrgIds.
    //
    // pct_assets_with_active_custody:
    //   numerator = Asset.count({ where: {
    //       Custody: { isNot: null },
    //       organizationId: { in: ids },
    //       createdAt: { lte: dataWindowEnd },
    //   }})
    //   denominator = Asset.count({ where: {
    //       organizationId: { in: ids },
    //       createdAt: { lte: dataWindowEnd },
    //   }})
    //   value = (numerator / denominator) * 100
    //   cohortSize = ctx.eligibleOrgIds.length
    //
    // Wrap the result with reportable({ ... }) — do NOT build a
    // ReportableAggregate directly.

    return {
        pct_assets_with_active_custody: notImplementedAggregate({
            key: "pct_assets_with_active_custody",
            label: "Of assets have an active custodian assigned",
            unit: "%",
        }),
    };
}
