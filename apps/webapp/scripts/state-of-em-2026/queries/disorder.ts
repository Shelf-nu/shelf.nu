/**
 * Cost-of-disorder queries — produces the v1.2 viral headline (IDLE-asset
 * dollar value, universal telemetry), the idle rate companion, the Found-
 * via-Scan recovery total, and the now-demoted audit-subset ghost-asset
 * rate.
 *
 * v1.2 pivot summary:
 *
 *   PRIMARY (universal, no feature dependency):
 *     ds_idle_asset_dollar_value_median_workspace  — THE HEADLINE.
 *                                                   Median workspace's $ value
 *                                                   of assets idle for 90+ days.
 *     ds_idle_asset_rate                            — % of tracked assets idle.
 *
 *   SUPPORTING (universal IF Scan model exposes anonymous detection):
 *     ds_recovery_dollar_value_total                — total $ recovered via
 *                                                   Found-via-Scan in window.
 *
 *   AUDIT-ENABLED SUBSET (qualified — published only with the qualifier
 *   "audit-enabled subset only" in the website MDX):
 *     ds_ghost_asset_rate                            — % of audited assets that
 *                                                   meet the ghost definition.
 *
 * Definitions in ../methodology.md. The probe in ../probe.ts decides which of
 * these survive to publication; this module computes them whether the probe
 * recommended dropping them or not. The website MDX is the gate.
 *
 * Asset.valuation coverage caveat: not every Asset row carries a valuation
 * (the field is workspace-entered). The dollar aggregates compute over the
 * assets that DO have a valuation, then median-extrapolate per workspace.
 * If the probe reports valuation coverage below 30%, the dollar headline
 * should be replaced by the percentage headline (`ds_idle_asset_rate`).
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
    // ---------------------------------------------------------------
    // PRIMARY: ds_idle_asset_dollar_value_median_workspace (THE HEADLINE)
    // ---------------------------------------------------------------
    // Idle = an Asset with no ActivityEvent (any action) in the prior 90
    // days at end of window, AND created before the 90-day idle window
    // opened (new assets without history are not idle).
    //
    // Implementation sketch (raw SQL recommended for the LEFT JOIN — Prisma's
    // ORM is awkward at "no related row in the last N days"):
    //
    //   WITH idle_cutoff AS (SELECT $dataWindowEnd::timestamptz - INTERVAL '90 days' AS t),
    //   eligible_assets AS (
    //     SELECT a.id, a."organizationId", a.value
    //     FROM "Asset" a, idle_cutoff
    //     WHERE a."organizationId" = ANY($eligibleOrgIds)
    //       AND a."createdAt" <= idle_cutoff.t
    //   ),
    //   recent_activity AS (
    //     SELECT DISTINCT ae."assetId"
    //     FROM "ActivityEvent" ae, idle_cutoff
    //     WHERE ae."assetId" IS NOT NULL
    //       AND ae."occurredAt" > idle_cutoff.t
    //       AND ae."occurredAt" <= $dataWindowEnd
    //   ),
    //   idle_assets AS (
    //     SELECT ea.*
    //     FROM eligible_assets ea
    //     LEFT JOIN recent_activity ra ON ra."assetId" = ea.id
    //     WHERE ra."assetId" IS NULL
    //   ),
    //   per_workspace AS (
    //     SELECT "organizationId", COALESCE(SUM(value), 0) AS idle_dollar_sum
    //     FROM idle_assets
    //     WHERE value IS NOT NULL
    //     GROUP BY "organizationId"
    //   )
    //   SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY idle_dollar_sum) AS median
    //   FROM per_workspace;
    //
    // NOTE: ActivityEvent only stores actions Shelf has chosen to record. If
    // a workspace uses Scan-only activity that does not produce an
    // ActivityEvent, asset would be flagged as idle when it is not. Sanity-
    // check: also LEFT JOIN against "Scan"."createdAt" > cutoff via
    // qrId → Qr.assetId. The methodology must disclose the signal sources.
    //
    // cohortSize = number of workspaces that contributed to the per_workspace
    // CTE (i.e. orgs with >= 1 valued idle asset). Apply k-anonymity to that
    // sub-cohort, not the global cohort.
    //
    // ---------------------------------------------------------------
    // ds_idle_asset_rate
    // ---------------------------------------------------------------
    // numerator   = COUNT(idle_assets)        — including those with no valuation
    // denominator = COUNT(eligible_assets)
    // value       = numerator / denominator * 100
    // cohortSize  = ctx.eligibleOrgIds.length  (universal stat)
    //
    // ---------------------------------------------------------------
    // ds_recovery_dollar_value_total (DEPENDS on anonymous-scan capability)
    // ---------------------------------------------------------------
    // Recovery = Scan event with userId IS NULL whose associated asset (via
    //            Qr → Asset) was previously marked Missing OR Idle in the
    //            window.
    //
    //   SELECT COALESCE(SUM(a.value), 0)
    //   FROM "Scan" s
    //   JOIN "Qr" q ON q.id = s."qrId"
    //   JOIN "Asset" a ON a.id = q."assetId"
    //   WHERE s."userId" IS NULL
    //     AND s."createdAt" BETWEEN $dataWindowStart AND $dataWindowEnd
    //     AND a."organizationId" = ANY($eligibleOrgIds)
    //     AND a.value IS NOT NULL
    //     AND EXISTS ( ... prior Missing OR Idle marker for this asset ... );
    //
    // Cohort: this is a platform-wide total, not per-workspace. K-anonymity
    // floor still applies to the count of recovery events behind the total
    // (>= 20 distinct recovery events; otherwise cohort_too_small).
    //
    // The probe in ../probe.ts pre-checks whether anonymous scans exist in
    // the window. If the probe returned `drop`, this query should bail to
    // not_implemented and the website MDX drops the recovery section.
    //
    // ---------------------------------------------------------------
    // AUDIT-ENABLED SUBSET: ds_ghost_asset_rate (qualified)
    // ---------------------------------------------------------------
    // Ghost = Asset where:
    //   - exists in inventory
    //   - was on the expected list of >= 2 consecutive AuditAsset rows
    //     with status = MISSING
    //   - has had no AuditScan or Scan event between those audits anywhere
    //     on the platform
    //
    // This is the v1.1 query, now scoped to the audit-enabled sub-cohort
    // and published only with explicit qualification ("audit-enabled
    // subset only — N% of cohort"). Implementation likely cleaner as raw
    // SQL than Prisma ORM. Use db.$queryRaw with parameterized inputs.
    //
    // CRITICAL: every aggregate goes through reportable({ ... }) for
    // k-anonymity + sig-fig rounding. Direct ReportableAggregate
    // construction bypasses safety; flag in code review.

    return {
        ds_idle_asset_dollar_value_median_workspace: notImplementedAggregate({
            key: "ds_idle_asset_dollar_value_median_workspace",
            label: "Median workspace's dollar value of equipment idle for 90+ days (THE HEADLINE)",
            unit: " USD",
        }),
        ds_idle_asset_rate: notImplementedAggregate({
            key: "ds_idle_asset_rate",
            label: "Of tracked assets had no activity in the prior 90 days at end of window",
            unit: "%",
        }),
        ds_recovery_dollar_value_total: notImplementedAggregate({
            key: "ds_recovery_dollar_value_total",
            label: "Total dollar value of equipment recovered via Found-via-Scan in window",
            unit: " USD",
        }),
        ds_ghost_asset_rate: notImplementedAggregate({
            key: "ds_ghost_asset_rate",
            label: "Of audited assets are ghost assets (audit-enabled subset only)",
            unit: "%",
        }),
    };
}
