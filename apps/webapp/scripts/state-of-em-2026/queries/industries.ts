/**
 * Industry cuts — segments the eligible cohort by industry and runs
 * representative queries per segment.
 *
 * Industries reported (matching website-v2 industryCuts):
 *   - Education
 *   - IT & Technology
 *   - Media & Production
 *   - Construction & Field Operations
 *
 * Industry assignment: best-effort via `UserBusinessIntel.primaryUseCase`
 * and `UserBusinessIntel.industry` on the workspace owner's record (per the
 * discovery report). Workspaces without business intel are bucketed as
 * "Unspecified" and excluded from per-industry stats.
 *
 * @see ../methodology.md — industry assignment
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { IndustryCut } from "../output-schema";

const INDUSTRIES = [
    "Education",
    "IT & Technology",
    "Media & Production",
    "Construction & Field Operations",
] as const;

export async function runIndustryQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<Record<string, IndustryCut>> {
    // TODO: implement.
    //
    // Implementation guidance:
    // - Step 1: for each industry, resolve the workspace subset via
    //   UserBusinessIntel joined to Organization via the owner.
    // - Step 2: apply the k-anonymity floor per industry. If a sub-cohort
    //   is too small, return cohortSize but null aggregates for that industry.
    // - Step 3: run the industry-specific queries:
    //     Education:           median assets, median users, peak booking month
    //     IT:                  % laptops/computing, median custody duration
    //     Media:               % kits in bookings, % camera/lens/audio assets
    //     Construction:        % multi-location workspaces, % tool assets
    // - Some stats are cross-industry (e.g. % laptops can be defined for any
    //   industry); reusing the visibility-query helpers and scoping to the
    //   industry's orgIds is the cleanest implementation.

    const result: Record<string, IndustryCut> = {};

    for (const industry of INDUSTRIES) {
        result[industry] = {
            industry,
            cohortSize: 0, // TODO: real per-industry workspace count
            aggregates: buildIndustryStubAggregates(industry),
        };
    }

    return result;
}

function buildIndustryStubAggregates(industry: string): Record<string, ReturnType<typeof notImplementedAggregate>> {
    switch (industry) {
        case "Education":
            return {
                ed_median_assets: notImplementedAggregate({
                    key: "ed_median_assets",
                    label: "Median assets per workspace",
                }),
                ed_median_users: notImplementedAggregate({
                    key: "ed_median_users",
                    label: "Median active users per workspace",
                }),
                ed_seasonal_peak_month: notImplementedAggregate({
                    key: "ed_seasonal_peak_month",
                    label: "Peak booking month",
                }),
            };
        case "IT & Technology":
            return {
                it_pct_laptops: notImplementedAggregate({
                    key: "it_pct_laptops",
                    label: "Of tracked assets are laptops or computing devices",
                    unit: "%",
                }),
                it_median_custody_duration_days: notImplementedAggregate({
                    key: "it_median_custody_duration_days",
                    label: "Median custody duration",
                    unit: " days",
                }),
            };
        case "Media & Production":
            return {
                mp_pct_kits: notImplementedAggregate({
                    key: "mp_pct_kits",
                    label: "Of bookings include at least one kit",
                    unit: "%",
                }),
                mp_pct_camera_lens_audio: notImplementedAggregate({
                    key: "mp_pct_camera_lens_audio",
                    label: "Of assets are camera, lens, or audio equipment",
                    unit: "%",
                }),
            };
        case "Construction & Field Operations":
            return {
                co_pct_multi_location: notImplementedAggregate({
                    key: "co_pct_multi_location",
                    label: "Of workspaces operate across two or more locations",
                    unit: "%",
                }),
                co_pct_tool_assets: notImplementedAggregate({
                    key: "co_pct_tool_assets",
                    label: "Of assets are categorized as tools",
                    unit: "%",
                }),
            };
        default:
            return {};
    }
}
