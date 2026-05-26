/**
 * Audits queries — "The audit reality" section.
 *
 * Produces (keys match website-v2 sectionStats.audits):
 *
 *   au_pct_workspaces_running_audits      — % of audits-enabled Orgs with >= 1 AuditSession
 *                                            reaching status COMPLETED in window
 *   au_pct_audited_assets_found           — % of expected AuditAsset rows with status Found
 *   au_pct_audited_assets_missing         — % with status Missing
 *   au_pct_audited_assets_unexpected      — % of AuditAsset rows where !expected
 *   median_audit_completion_days          — median (AuditSession.completedAt - startedAt) days
 *   au_median_completion_days             — alias of the above (mirrored in website data file)
 *
 * Cohort sub-filter: Organization.auditsEnabled = true (per the discovery
 * report's schema notes). Apply k-anonymity to this sub-cohort separately.
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runAuditsQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement.
    //
    // Implementation guidance:
    // - auditsEnabled sub-cohort: Organization.auditsEnabled = true AND
    //   in eligibleOrgIds.
    // - Workspaces running audits: count distinct AuditSession.organizationId
    //   where status = COMPLETED AND startedAt within window. Divide by the
    //   audits-enabled sub-cohort size.
    // - Found/Missing/Unexpected rates: sum AuditSession.foundAssetCount,
    //   missingAssetCount, unexpectedAssetCount, expectedAssetCount across
    //   sessions in window. Compute as percentages of total expected.
    // - Median completion days: per AuditSession in window with status = COMPLETED,
    //   (completedAt - startedAt). Take median in JS.

    return {
        au_pct_workspaces_running_audits: notImplementedAggregate({
            key: "au_pct_workspaces_running_audits",
            label: "Of Team-tier workspaces ran at least one audit in the year",
            unit: "%",
        }),
        au_pct_audited_assets_found: notImplementedAggregate({
            key: "au_pct_audited_assets_found",
            label: "Of expected assets came up Found",
            unit: "%",
        }),
        au_pct_audited_assets_missing: notImplementedAggregate({
            key: "au_pct_audited_assets_missing",
            label: "Of expected assets came up Missing",
            unit: "%",
        }),
        au_pct_audited_assets_unexpected: notImplementedAggregate({
            key: "au_pct_audited_assets_unexpected",
            label: "Of scanned assets were Unexpected (not on the expected list)",
            unit: "%",
        }),
        au_median_completion_days: notImplementedAggregate({
            key: "au_median_completion_days",
            label: "Median audit duration, start to complete",
            unit: " days",
        }),
        median_audit_completion_days: notImplementedAggregate({
            key: "median_audit_completion_days",
            label: "Median audit duration, start to complete",
            unit: " days",
        }),
    };
}
