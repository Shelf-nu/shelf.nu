/**
 * Cost-of-disorder queries — "The cost of disorder" section.
 *
 * Produces (keys match website-v2 sectionStats.disorder):
 *
 *   ds_ghost_asset_rate                 — % of audited Assets meeting the ghost-asset definition
 *   ds_idle_asset_rate                  — % of Assets with no ActivityEvent in prior 90 days
 *   ds_recovery_rate_found_via_scan     — % of Missing assets recovered via Found-via-Scan within 30d
 *   ds_median_recovery_days             — median (recoveredAt - markedMissingAt) days
 *
 * Definitions are precise — see ../methodology.md "Definitions" section.
 * Get these definitions right; they're what journalists and Wikipedia
 * editors will scrutinize.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runDisorderQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement.
    //
    // Implementation guidance:
    // - Ghost asset: an Asset marked Missing in two-or-more consecutive
    //   AuditAsset rows AND no AuditScan/Scan event between those audits.
    //   This is a window function over AuditAsset rows; likely cleaner as
    //   raw SQL than Prisma ORM.
    // - Idle asset rate: Asset with no ActivityEvent.occurredAt > (windowEnd - 90 days).
    //   Restrict to Assets that existed before windowEnd - 90 days (don't
    //   count brand-new assets as idle).
    // - Found-via-Scan recovery: requires distinguishing public/anonymous
    //   scans from authenticated scans. Check Scan table for the
    //   anonymous-source flag; methodology says these are the recovery
    //   events. If the flag doesn't exist, this stat may need to be
    //   not_implemented or dropped from v1.
    // - Median recovery days: (Scan.createdAt - last Missing AuditAsset row
    //   for the same asset). Take median across all recovered-Missing pairs.

    return {
        ds_ghost_asset_rate: notImplementedAggregate({
            key: "ds_ghost_asset_rate",
            label: "Of expected audit assets are estimated ghost assets",
            unit: "%",
        }),
        ds_idle_asset_rate: notImplementedAggregate({
            key: "ds_idle_asset_rate",
            label: "Of assets had no activity in the prior 90 days",
            unit: "%",
        }),
        ds_recovery_rate_found_via_scan: notImplementedAggregate({
            key: "ds_recovery_rate_found_via_scan",
            label: "Of Missing assets were recovered via Found-via-Scan within 30 days",
            unit: "%",
        }),
        ds_median_recovery_days: notImplementedAggregate({
            key: "ds_median_recovery_days",
            label: "Median time to recover an asset marked Missing",
            unit: " days",
        }),
    };
}
