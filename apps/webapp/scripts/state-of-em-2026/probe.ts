/**
 * Feature-adoption probe for the State of Equipment Management 2026 report.
 *
 * This is the FIRST thing the data team runs. Before any query module is
 * implemented and before any aggregate is published, the probe verifies
 * that feature adoption across the eligible cohort is high enough that
 * the v1.2 stat structure is defensible.
 *
 * Why this exists:
 *
 * v1.1 of the report leaned on ghost-asset-derived dollar headlines. The
 * problem: Audits is a paid add-on (`Organization.auditsEnabled`). If, say,
 * only 4% of Team workspaces have Audits enabled, framing "median ghost-
 * asset value per workspace" as a platform stat is dishonest — it's
 * actually "median ghost-asset value per audit-enabled minority". v1.2
 * pivoted the headline to idle-assets (universal `ActivityEvent` telemetry)
 * and demoted ghost-asset stats to a qualified subset finding.
 *
 * The probe quantifies that risk explicitly. It produces a single JSON
 * artifact the editorial team reads BEFORE we commit to the published stat
 * structure. If the probe shows audits adoption below `auditsEnabledMin`
 * (5%), the audit-subset stats are dropped from v1 entirely rather than
 * published with a thin disclaimer.
 *
 * Probes are not reportable aggregates — they are diagnostic numbers about
 * the cohort itself. They are not anonymized via `reportable()` because
 * they do not appear in the published report. They land in
 * `output/probe.json` for the data team's eyes only.
 *
 * @see ../methodology.md — risk-disclosure block in the published methodology
 * @see ../README.md — workflow (probe → choose stats → implement queries)
 * @see https://github.com/Shelf-nu/website-v2/blob/main/src/data/state-of-equipment-management-2026.ts
 *      — `adoptionThresholds` block on the website data file mirrors the
 *      thresholds used here. Keep them in sync.
 */

import type { ExtendedPrismaClient } from "@shelf/database";

import type { ExtractorContext } from "./context";

/**
 * Thresholds for stat survival. These mirror the
 * `reportMetadata.adoptionThresholds` block in
 * `src/data/state-of-equipment-management-2026.ts` on the website-v2 PR.
 *
 * Update both sides in the same commit.
 */
export const ADOPTION_THRESHOLDS = {
    /** Audits add-on adoption among eligible Team workspaces. Below this, audit-derived stats are scrapped. */
    auditsEnabledMin: 0.05,
    /** Workspaces that actually ran an audit in window. Below this, ghost-asset and missing-rate stats are scrapped. */
    auditsRunMin: 0.03,
    /** Workspaces with bookings activity. Below this, late-return stat is scrapped. */
    bookingsActiveMin: 0.1,
    /** Asset.valuation coverage across the cohort. Below this, dollar headlines convert to percentages. */
    valuationCoverageMin: 0.3,
} as const;

/**
 * Per-stat decision returned by the probe. The data team consumes this
 * directly: anything with `recommendation = "drop"` is excluded from v1.
 */
export type ProbeRecommendation = "publish" | "qualify" | "convert" | "drop";

/**
 * One probe row per stat that depends on feature adoption. The probe
 * surfaces the raw measurement (`adoptionRate`) and the resulting
 * `recommendation` so editorial decisions are traceable.
 */
export interface ProbeRow {
    statKey: string;
    /** Plain-English description of what we measured. */
    measured: string;
    /** Numerator from the measurement (e.g. count of audits-enabled orgs). */
    numerator: number;
    /** Denominator (typically the eligible cohort size). */
    denominator: number;
    /** numerator / denominator. Undefined when denominator is 0. */
    adoptionRate: number | null;
    /** The threshold this rate is compared against. */
    threshold: number;
    /** Decision for the editorial team. */
    recommendation: ProbeRecommendation;
    /** Human-readable rationale that explains the recommendation. */
    rationale: string;
}

/**
 * Anonymous-scan capability check. The recovery stat (`ds_recovery_dollar
 * _value_total`) requires that we can detect Found-via-Scan events from
 * non-logged-in scanners. The Scan model uses `userId IS NULL` to indicate
 * an anonymous scan (the schema does not have a dedicated boolean column);
 * the probe confirms this signal is present and computes how many such
 * events landed in the window.
 */
export interface AnonymousScanProbe {
    /** Does the Scan model expose a way to identify anonymous scans? */
    detectionMethodAvailable: boolean;
    /** Field/condition used. */
    detectionMethod: string;
    /** Count of anonymous scans in the data window across all orgs. */
    countInWindow: number;
    recommendation: ProbeRecommendation;
    rationale: string;
}

/**
 * Top-level probe output. Written to `./output/probe.json` so the data team
 * can review it before running the full extractor. The script's `--probe`
 * mode skips the regular aggregate emission and writes only this file.
 */
export interface ProbeOutput {
    /** ISO 8601 timestamp the probe ran at. */
    probedAt: string;
    /** Data window the probe checked against. */
    dataWindowStart: string;
    dataWindowEnd: string;
    /** Eligible cohort size — every adoption rate is denominated against this. */
    cohortSize: number;
    /** Thresholds the probe used (echoed for traceability). */
    thresholds: typeof ADOPTION_THRESHOLDS;
    /** Per-stat adoption findings. */
    rows: ProbeRow[];
    /** Anonymous-scan capability check (drives the recovery stat decision). */
    anonymousScan: AnonymousScanProbe;
    /**
     * Stats the data team should drop from v1 based on the probe. Computed
     * here so the human reviewer doesn't have to derive it.
     */
    statsToDrop: string[];
    /**
     * Stats that survived but should be published with explicit qualification
     * (e.g. "Audit-enabled subset only — N% of cohort").
     */
    statsToQualify: string[];
}

/**
 * Run the probe. Reads only — no writes. Returns the structured probe
 * output for the orchestrator to serialize.
 */
export async function runProbe(
    db: ExtendedPrismaClient,
    ctx: ExtractorContext,
): Promise<ProbeOutput> {
    const cohortSize = ctx.eligibleOrgIds.length;

    // ----- Audits enabled (paid add-on) -----
    const auditsEnabledCount = await db.organization.count({
        where: {
            id: { in: ctx.eligibleOrgIds },
            auditsEnabled: true,
        },
    });
    const auditsEnabledRate = safeRate(auditsEnabledCount, cohortSize);

    // ----- Audits actually run (>= 1 COMPLETED AuditSession in window) -----
    const auditingOrgs = await db.auditSession.findMany({
        where: {
            organizationId: { in: ctx.eligibleOrgIds },
            status: "COMPLETED",
            startedAt: {
                gte: ctx.dataWindowStart,
                lte: ctx.dataWindowEnd,
            },
        },
        distinct: ["organizationId"],
        select: { organizationId: true },
    });
    const auditsRunCount = auditingOrgs.length;
    const auditsRunRate = safeRate(auditsRunCount, cohortSize);

    // ----- Bookings activity in window -----
    const bookingOrgs = await db.booking.findMany({
        where: {
            organizationId: { in: ctx.eligibleOrgIds },
            from: {
                gte: ctx.dataWindowStart,
                lte: ctx.dataWindowEnd,
            },
            // Drafts are not real bookings; they would inflate this count.
            status: { not: "DRAFT" },
        },
        distinct: ["organizationId"],
        select: { organizationId: true },
    });
    const bookingsActiveCount = bookingOrgs.length;
    const bookingsActiveRate = safeRate(bookingsActiveCount, cohortSize);

    // ----- Asset.valuation coverage (across the cohort) -----
    const assetsTotal = await db.asset.count({
        where: {
            organizationId: { in: ctx.eligibleOrgIds },
            createdAt: { lte: ctx.dataWindowEnd },
        },
    });
    const assetsWithValuation = await db.asset.count({
        where: {
            organizationId: { in: ctx.eligibleOrgIds },
            createdAt: { lte: ctx.dataWindowEnd },
            valuation: { not: null },
        },
    });
    const valuationCoverageRate = safeRate(assetsWithValuation, assetsTotal);

    // ----- Custody coverage (sanity check; threshold is editorial, not gating) -----
    const assetsWithCustody = await db.asset.count({
        where: {
            organizationId: { in: ctx.eligibleOrgIds },
            createdAt: { lte: ctx.dataWindowEnd },
            custody: { isNot: null },
        },
    });
    const custodyCoverageRate = safeRate(assetsWithCustody, assetsTotal);

    // ----- Anonymous-scan capability check -----
    // The schema does not expose a `anonymous: Boolean` flag on Scan — the
    // signal is `userId IS NULL`. The probe verifies the signal works by
    // counting such scans in the window. A non-zero count confirms the
    // capability; a zero count is a soft warning (could be no recovery
    // events in window, or could be a wiring problem upstream).
    const anonymousScanCount = await db.scan.count({
        where: {
            userId: null,
            createdAt: {
                gte: ctx.dataWindowStart,
                lte: ctx.dataWindowEnd,
            },
        },
    });
    const anonymousScan: AnonymousScanProbe = {
        detectionMethodAvailable: true,
        detectionMethod: "Scan.userId IS NULL",
        countInWindow: anonymousScanCount,
        recommendation:
            anonymousScanCount >= 20 ? "publish" : anonymousScanCount > 0 ? "qualify" : "drop",
        rationale:
            anonymousScanCount >= 20
                ? "Sufficient anonymous-scan volume to attribute Found-via-Scan recovery without identifying any single workspace."
                : anonymousScanCount > 0
                    ? `Only ${anonymousScanCount} anonymous scans in window — below k=20 floor. Publish only as percentage or omit dollar version.`
                    : "Zero anonymous scans detected in window. Either the data window has no recovery events or the detection method is mis-wired. Drop the recovery stat and investigate.",
    };

    // ----- Per-stat adoption decisions -----
    const rows: ProbeRow[] = [
        {
            statKey: "ds_idle_asset_dollar_value_median_workspace",
            measured:
                "Asset.valuation coverage across cohort (denominator for dollar median; dollars are conservative lower bound)",
            numerator: assetsWithValuation,
            denominator: assetsTotal,
            adoptionRate: valuationCoverageRate,
            threshold: ADOPTION_THRESHOLDS.valuationCoverageMin,
            recommendation: decideValuationDriven(valuationCoverageRate),
            rationale: rationaleValuation(valuationCoverageRate),
        },
        {
            statKey: "ds_idle_asset_rate",
            measured:
                "Universal: idle rate via ActivityEvent. No feature dependency, only k-anonymity floor at query time.",
            numerator: cohortSize,
            denominator: cohortSize,
            adoptionRate: cohortSize > 0 ? 1 : null,
            threshold: 0,
            recommendation: cohortSize >= ctx.minCohortSize ? "publish" : "drop",
            rationale:
                cohortSize >= ctx.minCohortSize
                    ? "Universal telemetry — no feature-adoption risk."
                    : "Eligible cohort itself is below k=20 floor; entire report is unreportable.",
        },
        {
            statKey: "pct_assets_with_active_custody",
            measured: "Universal: Custody row presence across the cohort.",
            numerator: assetsWithCustody,
            denominator: assetsTotal,
            adoptionRate: custodyCoverageRate,
            threshold: 0,
            recommendation: assetsTotal > 0 ? "publish" : "drop",
            rationale:
                assetsTotal > 0
                    ? `Custody coverage measured at ${pct(custodyCoverageRate)}. Universal stat — no threshold gating.`
                    : "No assets in cohort; cannot compute.",
        },
        {
            statKey: "bk_pct_returned_late",
            measured: "% of eligible orgs with at least one non-DRAFT Booking in window",
            numerator: bookingsActiveCount,
            denominator: cohortSize,
            adoptionRate: bookingsActiveRate,
            threshold: ADOPTION_THRESHOLDS.bookingsActiveMin,
            recommendation: decideBookings(bookingsActiveRate),
            rationale: rationaleBookings(bookingsActiveRate, bookingsActiveCount),
        },
        {
            statKey: "ds_recovery_dollar_value_total",
            measured: "Anonymous Scans in window (detection via userId IS NULL)",
            numerator: anonymousScanCount,
            denominator: cohortSize,
            adoptionRate: cohortSize > 0 ? anonymousScanCount / cohortSize : null,
            threshold: 0.01, // soft check; recovery stat is a platform total not per-org
            recommendation: anonymousScan.recommendation,
            rationale: anonymousScan.rationale,
        },
        {
            statKey: "ds_ghost_asset_rate",
            measured: "% of eligible orgs that ran >= 1 COMPLETED AuditSession in window",
            numerator: auditsRunCount,
            denominator: cohortSize,
            adoptionRate: auditsRunRate,
            threshold: ADOPTION_THRESHOLDS.auditsRunMin,
            recommendation: decideAuditsRun(auditsRunRate),
            rationale: rationaleAuditsRun(auditsRunRate, auditsRunCount),
        },
        {
            statKey: "au_pct_audited_assets_missing",
            measured:
                "Same sub-cohort as ghost rate: orgs that ran an audit in window. Reported as audit-enabled subset stat.",
            numerator: auditsRunCount,
            denominator: cohortSize,
            adoptionRate: auditsRunRate,
            threshold: ADOPTION_THRESHOLDS.auditsRunMin,
            recommendation: decideAuditsRun(auditsRunRate),
            rationale: rationaleAuditsRun(auditsRunRate, auditsRunCount),
        },
    ];

    // ----- Aggregate to-drop / to-qualify lists for the human reviewer -----
    const statsToDrop = rows
        .filter((r) => r.recommendation === "drop")
        .map((r) => r.statKey);
    const statsToQualify = rows
        .filter((r) => r.recommendation === "qualify" || r.recommendation === "convert")
        .map((r) => r.statKey);

    // ----- Adoption-level audits header (used by orchestrator to log) -----
    // The probe also surfaces a top-level audits-enabled rate for editorial
    // context — even if no stat directly gates on it, the rate informs how
    // the audit-subset narrative is written.
    rows.unshift({
        statKey: "_meta__audits_enabled",
        measured:
            "% of eligible orgs with Audits add-on enabled (paid feature). Editorial context only — does not directly gate a stat.",
        numerator: auditsEnabledCount,
        denominator: cohortSize,
        adoptionRate: auditsEnabledRate,
        threshold: ADOPTION_THRESHOLDS.auditsEnabledMin,
        recommendation: auditsEnabledRate !== null && auditsEnabledRate >= ADOPTION_THRESHOLDS.auditsEnabledMin ? "publish" : "qualify",
        rationale:
            auditsEnabledRate !== null && auditsEnabledRate >= ADOPTION_THRESHOLDS.auditsEnabledMin
                ? `Audits add-on enabled in ${pct(auditsEnabledRate)} of cohort — large enough to publish a qualified audit-subset section.`
                : `Audits adoption is ${pct(auditsEnabledRate)}, below the ${pct(ADOPTION_THRESHOLDS.auditsEnabledMin)} threshold. Consider cutting the entire audit-subset section.`,
    });

    return {
        probedAt: new Date().toISOString(),
        dataWindowStart: ctx.dataWindowStart.toISOString(),
        dataWindowEnd: ctx.dataWindowEnd.toISOString(),
        cohortSize,
        thresholds: ADOPTION_THRESHOLDS,
        rows,
        anonymousScan,
        statsToDrop,
        statsToQualify,
    };
}

/**
 * Pretty-print the probe to stdout. Used by the orchestrator when running
 * in `--probe` mode so the data team can read the result at the terminal
 * without opening the JSON file.
 */
export function printProbeSummary(probe: ProbeOutput): void {
    console.log(
        "\n=== Feature-adoption probe ===\n" +
            `Cohort size:   ${probe.cohortSize}\n` +
            `Data window:   ${probe.dataWindowStart.slice(0, 10)} → ${probe.dataWindowEnd.slice(0, 10)}\n` +
            `Probed at:     ${probe.probedAt}\n`,
    );

    for (const row of probe.rows) {
        const rate = row.adoptionRate === null ? "n/a" : pct(row.adoptionRate);
        const flag = recommendationFlag(row.recommendation);
        console.log(
            `${flag} ${row.statKey}\n` +
                `   measured: ${row.measured}\n` +
                `   adoption: ${rate}  (threshold: ${pct(row.threshold)})  →  ${row.recommendation.toUpperCase()}\n` +
                `   ${row.rationale}\n`,
        );
    }

    console.log(
        "Anonymous-scan capability check\n" +
            `   detection:     ${probe.anonymousScan.detectionMethod}\n` +
            `   in-window:     ${probe.anonymousScan.countInWindow}\n` +
            `   decision:      ${probe.anonymousScan.recommendation.toUpperCase()}\n` +
            `   ${probe.anonymousScan.rationale}\n`,
    );

    if (probe.statsToDrop.length > 0) {
        console.log(
            `\nSTATS TO DROP FROM v1 (below threshold):\n` +
                probe.statsToDrop.map((s) => `  - ${s}`).join("\n"),
        );
    }
    if (probe.statsToQualify.length > 0) {
        console.log(
            `\nSTATS TO PUBLISH WITH QUALIFICATION:\n` +
                probe.statsToQualify.map((s) => `  - ${s}`).join("\n"),
        );
    }
    if (probe.statsToDrop.length === 0 && probe.statsToQualify.length === 0) {
        console.log("\nAll v1.2 stats clear the adoption thresholds. Proceed to query implementation.\n");
    }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function safeRate(num: number, den: number): number | null {
    return den > 0 ? num / den : null;
}

function pct(rate: number | null): string {
    if (rate === null) return "n/a";
    return `${(rate * 100).toFixed(1)}%`;
}

function decideAuditsRun(rate: number | null): ProbeRecommendation {
    if (rate === null) return "drop";
    if (rate >= ADOPTION_THRESHOLDS.auditsRunMin) return "qualify";
    return "drop";
}

function rationaleAuditsRun(rate: number | null, count: number): string {
    if (rate === null) return "Cannot compute audits-run rate (cohort size zero).";
    if (rate >= ADOPTION_THRESHOLDS.auditsRunMin) {
        return `${count} orgs (${pct(rate)} of cohort) ran an audit in window. Publish as "audit-enabled subset" finding with explicit qualification; never as platform median.`;
    }
    return `Only ${count} orgs (${pct(rate)} of cohort) ran an audit in window — below the ${pct(ADOPTION_THRESHOLDS.auditsRunMin)} threshold. Drop audit-derived stats from v1 to avoid the "median of an audit-enabled minority" framing risk.`;
}

function decideBookings(rate: number | null): ProbeRecommendation {
    if (rate === null) return "drop";
    if (rate >= ADOPTION_THRESHOLDS.bookingsActiveMin) return "qualify";
    return "drop";
}

function rationaleBookings(rate: number | null, count: number): string {
    if (rate === null) return "Cannot compute bookings-active rate (cohort size zero).";
    if (rate >= ADOPTION_THRESHOLDS.bookingsActiveMin) {
        return `${count} orgs (${pct(rate)} of cohort) have bookings activity in window. Publish bk_pct_returned_late with the standing "among workspaces using bookings" qualifier.`;
    }
    return `Only ${count} orgs (${pct(rate)} of cohort) use bookings — below the ${pct(ADOPTION_THRESHOLDS.bookingsActiveMin)} threshold. Drop the late-return stat from v1.`;
}

function decideValuationDriven(rate: number | null): ProbeRecommendation {
    if (rate === null) return "drop";
    if (rate >= ADOPTION_THRESHOLDS.valuationCoverageMin) return "publish";
    return "convert";
}

function rationaleValuation(rate: number | null): string {
    if (rate === null) return "Cannot compute valuation coverage.";
    if (rate >= ADOPTION_THRESHOLDS.valuationCoverageMin) {
        return `Asset.valuation coverage is ${pct(rate)} — clears the ${pct(ADOPTION_THRESHOLDS.valuationCoverageMin)} threshold. Publish dollar headline as conservative lower bound; disclose coverage in methodology.`;
    }
    return `Asset.valuation coverage is only ${pct(rate)} — below the ${pct(ADOPTION_THRESHOLDS.valuationCoverageMin)} threshold. CONVERT the dollar headline to a percentage headline (idle rate) and drop the dollar figure to avoid an unrepresentative number.`;
}

function recommendationFlag(rec: ProbeRecommendation): string {
    switch (rec) {
        case "publish":
            return "[OK    ]";
        case "qualify":
            return "[QUAL  ]";
        case "convert":
            return "[CONV  ]";
        case "drop":
            return "[DROP  ]";
    }
}
