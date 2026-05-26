/**
 * Audits queries — trimmed to the two stats in the v1 published headline
 * structure.
 *
 * Produces:
 *   au_pct_workspaces_running_audits  — % of audits-enabled Orgs with >= 1
 *                                       AuditSession reaching COMPLETED
 *                                       status in the window
 *   au_pct_audited_assets_missing      — % of expected AuditAsset rows that
 *                                       came up Missing on first scan
 *
 * The original v0 audit stubs (au_pct_audited_assets_found, au_pct_audited
 * _assets_unexpected, au_median_completion_days, median_audit_completion_
 * days) were cut from the published report. They remain in git history
 * for restoration in 2027 if useful.
 *
 * Cohort sub-filter: Organization.auditsEnabled = true AND in eligibleOrgIds.
 * Apply k-anonymity to this sub-cohort separately — don't rely on the
 * global eligible cohort floor.
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
    // Step 1: build the audits-enabled sub-cohort.
    //   const auditEnabledOrgIds = await db.organization.findMany({
    //       where: { id: { in: ctx.eligibleOrgIds }, auditsEnabled: true },
    //       select: { id: true },
    //   }).then(rows => rows.map(r => r.id));
    //
    // Step 2: workspaces running audits.
    //   const auditingOrgIds = await db.auditSession.findMany({
    //       where: {
    //           organizationId: { in: auditEnabledOrgIds },
    //           status: "COMPLETED",
    //           startedAt: { gte: ctx.dataWindowStart, lte: ctx.dataWindowEnd },
    //       },
    //       distinct: ['organizationId'],
    //       select: { organizationId: true },
    //   }).then(rows => new Set(rows.map(r => r.organizationId)));
    //   value = (auditingOrgIds.size / auditEnabledOrgIds.length) * 100
    //   cohortSize = auditEnabledOrgIds.length
    //
    // Step 3: missing rate.
    //   const sums = await db.auditSession.aggregate({
    //       where: { ... within window, COMPLETED, in audits-enabled orgs ... },
    //       _sum: { expectedAssetCount: true, missingAssetCount: true },
    //   });
    //   value = (missing / expected) * 100
    //   cohortSize = number of audit sessions OR number of contributing orgs;
    //   pick the more conservative (orgs).

    return {
        au_pct_workspaces_running_audits: notImplementedAggregate({
            key: "au_pct_workspaces_running_audits",
            label: "Of Team-tier workspaces with the Audits add-on ran at least one audit in the year",
            unit: "%",
        }),
        au_pct_audited_assets_missing: notImplementedAggregate({
            key: "au_pct_audited_assets_missing",
            label: "Of expected assets came up Missing on the first audit scan",
            unit: "%",
        }),
    };
}
