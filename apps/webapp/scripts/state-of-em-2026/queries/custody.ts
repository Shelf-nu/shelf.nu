/**
 * Custody queries — "Custody and accountability" section.
 *
 * Produces (keys match website-v2 sectionStats.custody):
 *
 *   cu_pct_assets_with_history          — % of Assets with >= 1 custody ActivityEvent in window
 *   cu_median_handovers_per_asset_per_year — median count of custody transfer events per
 *                                            active asset over the window
 *   cu_top_handover_categories           — top categories by mean handover count per asset
 *
 * Custody is split between two sources:
 * - `Custody` table = current state (one row per asset that currently has custody)
 * - `ActivityEvent` rows where action indicates custody transfer = history
 *
 * Per the discovery report: don't reconstruct history from Custody.updatedAt;
 * use ActivityEvent rows with custody-related action enum values.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runCustodyQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement.
    //
    // Implementation guidance:
    // - Confirm the exact ActivityAction enum values that represent custody
    //   transfer (likely CUSTODY_ASSIGN, CUSTODY_RELEASE, CUSTODY_TRANSFER
    //   or similar). Inspect packages/database/prisma/schema.prisma for the
    //   ActivityAction enum.
    // - Active asset = Asset with at least one ActivityEvent in the window
    //   (any action, not just custody-related).
    // - Handover count per asset = count of ActivityEvent rows of the
    //   custody-related action enum values, grouped by assetId, within window.
    // - Top handover categories: groupBy assetId.categoryId then average the
    //   handover counts; restrict to categories with >= --min-cohort-size
    //   distinct workspaces.

    return {
        cu_pct_assets_with_history: notImplementedAggregate({
            key: "cu_pct_assets_with_history",
            label: "Of assets have one or more custody events in the last year",
            unit: "%",
        }),
        cu_median_handovers_per_asset_per_year: notImplementedAggregate({
            key: "cu_median_handovers_per_asset_per_year",
            label: "Median custody handovers per asset per year (active assets only)",
        }),
        cu_top_handover_categories: notImplementedAggregate({
            key: "cu_top_handover_categories",
            label: "Asset categories with the highest handover rate",
        }),
    };
}
