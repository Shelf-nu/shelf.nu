/**
 * Cost-of-disorder queries — the section that contains the v1 viral
 * headline stat.
 *
 * Produces:
 *   ds_ghost_asset_dollar_value_median_workspace  — THE HEADLINE STAT.
 *                                                   Median workspace's dollar
 *                                                   value of ghost assets.
 *   ds_ghost_asset_rate                            — % of audited assets that
 *                                                   meet the ghost definition.
 *                                                   Feeder to the headline.
 *   ds_idle_asset_dollar_value_median_workspace    — Median workspace's dollar
 *                                                   value of idle assets.
 *   ds_recovery_dollar_value_total                  — Total dollar value of
 *                                                   assets recovered via
 *                                                   Found-via-Scan in window.
 *
 * Definitions in ../methodology.md — these are the most-scrutinized
 * definitions in the report. Don't drift from them.
 *
 * Asset.valuation coverage caveat: not every Asset row carries a valuation
 * (the field is workspace-entered). The dollar aggregates compute over
 * the assets that DO have a valuation, then median-extrapolate per
 * workspace. Disclose the coverage percentage in the methodology.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runDisorderQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement — this is THE most important file to get right.
    //
    // Step A: identify ghost assets per workspace.
    //   Ghost = Asset where:
    //     - exists in inventory
    //     - was on expected list of >= 2 consecutive AuditAsset rows
    //       with status = MISSING
    //     - has no AuditScan or Scan event between those audits anywhere
    //       on the platform
    //   Implementation hint: this is a window function over AuditAsset
    //   rows ordered by AuditSession.startedAt per asset, looking for
    //   runs of consecutive MISSING with no scan in between. Likely
    //   cleaner as raw SQL than Prisma ORM. Use db.$queryRaw with
    //   parameterized inputs.
    //
    // Step B: dollar value of ghost assets per workspace.
    //   For each org's ghost-asset list, sum Asset.valuation where set.
    //   workspaceGhostValue[orgId] = sum.
    //   ds_ghost_asset_dollar_value_median_workspace = median across orgs.
    //   Restrict to orgs with >= 1 ghost AND >= 1 valuation set.
    //   COHORT NOTE: this sub-cohort (orgs with ghost-asset measurements)
    //   may be smaller than the eligible cohort. Apply k-anonymity to the
    //   sub-cohort, not the global cohort.
    //
    // Step C: ghost-asset rate.
    //   numerator = total ghost AuditAsset rows across window
    //   denominator = total expected AuditAsset rows across window
    //   Cohort = audits-enabled orgs (same sub-cohort as audits queries).
    //
    // Step D: idle asset dollar value.
    //   Idle = Asset with no ActivityEvent in prior 90 days at end of window.
    //   Exclude assets created within the 90-day idle window (don't count
    //   brand-new assets as idle).
    //   Sum Asset.valuation where set, per org. Median across orgs.
    //
    // Step E: Found-via-Scan recovery total dollar value.
    //   Recovery = Scan event where source = anonymous AND associated
    //   Asset was previously Missing in an audit. Verify the anonymous-
    //   source flag exists on Scan; if not, this stat is not_implemented
    //   until telemetry is added.
    //   Sum Asset.valuation for recovered assets across window across
    //   all workspaces (single total, not per-workspace).
    //
    // CRITICAL: every aggregate goes through reportable({ ... }) for
    // k-anonymity + sig-fig rounding. Direct ReportableAggregate
    // construction bypasses safety; flag in code review.

    return {
        ds_ghost_asset_dollar_value_median_workspace: notImplementedAggregate({
            key: "ds_ghost_asset_dollar_value_median_workspace",
            label: "Median workspace's dollar value of ghost assets (on books, missing from audits)",
            unit: " USD",
        }),
        ds_ghost_asset_rate: notImplementedAggregate({
            key: "ds_ghost_asset_rate",
            label: "Of audited assets are ghost assets across the platform",
            unit: "%",
        }),
        ds_idle_asset_dollar_value_median_workspace: notImplementedAggregate({
            key: "ds_idle_asset_dollar_value_median_workspace",
            label: "Median workspace's dollar value of idle assets (no activity in 90 days)",
            unit: " USD",
        }),
        ds_recovery_dollar_value_total: notImplementedAggregate({
            key: "ds_recovery_dollar_value_total",
            label: "Total dollar value of equipment recovered via Found-via-Scan in window",
            unit: " USD",
        }),
    };
}
