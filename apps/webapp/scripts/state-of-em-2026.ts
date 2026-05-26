/**
 * State of Equipment Management 2026 — Aggregate Extraction (orchestrator).
 *
 * Trimmed in v1.1 per editorial review: the published report is organized
 * around 8 prioritized stats and one viral headline (ghost-assets-in-
 * dollars). The orchestrator only calls the query modules that produce
 * those stats. Bookings, custody (handover history), industries, and
 * top-performer pattern queries are deferred to the 2027 edition; their
 * stubs remain in the queries/ directory for future restoration but are
 * not invoked here.
 *
 * @see ./state-of-em-2026/README.md — workflow + the trimmed-scope explanation
 * @see ./state-of-em-2026/methodology.md — published methodology
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createDatabaseClient } from "@shelf/database";

import {
    HelpRequested,
    parseExtractorArgs,
    USAGE,
    type ExtractorCliOptions,
} from "./state-of-em-2026/cli";
import { buildEligibleCohort } from "./state-of-em-2026/cohort";
import { stripRawValues } from "./state-of-em-2026/anonymize";
import {
    buildEmptyOutput,
    type ExtractorOutput,
} from "./state-of-em-2026/output-schema";
import type { ExtractorContext } from "./state-of-em-2026/context";
import { runVisibilityQueries } from "./state-of-em-2026/queries/visibility";
import { runAuditsQueries } from "./state-of-em-2026/queries/audits";
import { runDisorderQueries } from "./state-of-em-2026/queries/disorder";
// DEFERRED in v1 — retained in repo for 2027 restoration:
//   import { runBookingsQueries } from "./state-of-em-2026/queries/bookings";
//   import { runCustodyQueries } from "./state-of-em-2026/queries/custody";
//   import { runIndustryQueries } from "./state-of-em-2026/queries/industries";
//   import { runTopPerformerQueries } from "./state-of-em-2026/queries/top-performers";

/** Stable identifier for this dataset — matches website frontmatter. */
const DATASET_KEY = "soem-2026-v1";
/** Methodology version — bump in lockstep with ./state-of-em-2026/methodology.md */
const METHODOLOGY_VERSION = "1.0";
/** Script version for output traceability. Bump on any logic change. */
const SCRIPT_VERSION = "0.2.0";

async function main(): Promise<void> {
    const options = parseOptionsOrExit();

    // Production guard — mirrors seed-reporting-demo.ts pattern.
    if (
        process.env.NODE_ENV === "production" &&
        !options.iKnowWhatImDoing
    ) {
        console.error(
            "\nRefusing to run with NODE_ENV=production without --i-know-what-im-doing.\n" +
                "This script reads from the production database — confirm intent and try again.\n",
        );
        process.exit(2);
    }

    printRunHeader(options);

    const db = createDatabaseClient();

    try {
        await db.$connect();

        // 1. Build the eligible cohort.
        console.log("\nBuilding eligible-workspace cohort…");
        const { orgIds, summary } = await buildEligibleCohort(db, options);
        console.log(
            `  ${summary.totalEligible} baseline orgs → ${summary.finalCohortSize} after filters` +
                ` (${summary.excludedByAssetCount} excluded by <${options.minAssets} assets,` +
                ` ${summary.excludedByAllowlist} excluded by allowlist).` +
                `\n  Total assets in cohort: ${summary.totalAssets.toLocaleString()}.`,
        );

        if (orgIds.length < options.minCohortSize) {
            console.error(
                `\nCohort size ${orgIds.length} is below --min-cohort-size ${options.minCohortSize}.\n` +
                    "Refusing to run — the entire report would be unreportable.\n",
            );
            process.exit(3);
        }

        const ctx: ExtractorContext = {
            db,
            options,
            dataWindowStart: options.dataWindowStart,
            dataWindowEnd: options.dataWindowEnd,
            minCohortSize: options.minCohortSize,
            eligibleOrgIds: orgIds,
            cohortSummary: summary,
        };

        // 2. Build the output skeleton.
        const output = buildEmptyOutput({
            datasetKey: DATASET_KEY,
            methodologyVersion: METHODOLOGY_VERSION,
            dataWindowStart: options.dataWindowStart,
            dataWindowEnd: options.dataWindowEnd,
            scriptVersion: SCRIPT_VERSION,
            cohort: summary,
        });

        // 3. Run the v1 query sections — only the three that feed the
        //    8-stat published headline structure. Survey data (the 8th
        //    stat) is plugged into the website data file manually after
        //    the external survey tool collects responses; it is not
        //    produced by this script.
        await runSection("Visibility", () => runVisibilityQueries(db, ctx), output);
        await runSection("Audits", () => runAuditsQueries(db, ctx), output);
        await runSection("Cost of disorder (ghost-asset headline)", () => runDisorderQueries(db, ctx), output);

        // DEFERRED v1.1: bookings, custody (history), industries, and
        // top-performer patterns. The query stubs remain in the queries/
        // directory for restoration. To re-enable, uncomment the imports
        // above and add their runSection calls here.

        // 4. Industry cuts — empty in v1 (deferred to 2027 when sample is large).
        output.industries = {};

        // 5. Defense-in-depth: strip raw values before writing.
        for (const key of Object.keys(output.aggregates)) {
            output.aggregates[key] = stripRawValues(output.aggregates[key]);
        }

        // 6. Summarize status counts.
        printStatusSummary(output);

        // 7. Write the output (unless --dry-run).
        if (options.dryRun) {
            console.log("\n--dry-run passed: skipping file writes.\n");
            return;
        }

        await writeOutput(output, options.outputPath);
        console.log(`\nWrote ${options.outputPath}\n`);

        // 8. (Optional) CSV companion. Not implemented in v1.
        if (options.csvPath) {
            console.warn(
                `\nNote: --csv was passed (${options.csvPath}) but CSV emission is not yet implemented.\n` +
                    "See state-of-em-2026/output-schema.ts to add it.\n",
            );
        }

        console.log(
            "Reminder: the survey-derived stat (survey_hours_lost_per_month_median)\n" +
                "is plugged into the website data file manually after the external\n" +
                "survey tool collects responses. See\n" +
                "content/reports/research-inputs/survey-design.md on the website-v2 PR.\n",
        );
    } finally {
        await db.$disconnect();
    }
}

function parseOptionsOrExit(): ExtractorCliOptions {
    try {
        return parseExtractorArgs(process.argv.slice(2));
    } catch (err) {
        if (err instanceof HelpRequested) {
            console.log(USAGE);
            process.exit(0);
        }
        console.error(
            `\nError: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        console.error(USAGE);
        process.exit(1);
    }
}

async function runSection<T extends Record<string, unknown>>(
    label: string,
    runner: () => Promise<T>,
    output: ExtractorOutput,
): Promise<void> {
    console.log(`\nRunning ${label}…`);
    try {
        const results = await runner();
        Object.assign(output.aggregates, results);
        const okCount = Object.values(results).filter(
            (v: any) => v && typeof v === "object" && (v as any).status === "ok",
        ).length;
        const totalCount = Object.keys(results).length;
        console.log(`  ${okCount}/${totalCount} aggregates ready.`);
    } catch (err) {
        console.error(
            `  Section "${label}" failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

async function writeOutput(
    output: ExtractorOutput,
    path: string,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(output, null, 2) + "\n", "utf8");
}

function printRunHeader(options: ExtractorCliOptions): void {
    const mode = options.dryRun ? "DRY RUN" : "LIVE RUN";
    console.log(
        `\n=== State of Equipment Management 2026 — extraction (${mode}) ===\n` +
            `Data window:     ${options.dataWindowStart.toISOString().slice(0, 10)} → ` +
            `${options.dataWindowEnd.toISOString().slice(0, 10)}\n` +
            `Output:          ${options.outputPath}\n` +
            `Min assets:      ${options.minAssets} per workspace\n` +
            `Min cohort size: ${options.minCohortSize}\n` +
            `Allowlist:       ${options.internalAllowlistPath}\n` +
            `Methodology:     v${METHODOLOGY_VERSION}\n` +
            `Script:          v${SCRIPT_VERSION}\n` +
            `Scope:           v1 trimmed — 8 stats, ghost-asset headline\n`,
    );
}

function printStatusSummary(output: ExtractorOutput): void {
    const counts = { ok: 0, cohort_too_small: 0, not_implemented: 0 };
    for (const agg of Object.values(output.aggregates)) {
        counts[agg.status] += 1;
    }
    console.log(
        "\n=== Aggregate status summary ===\n" +
            `  ok                 ${counts.ok}\n` +
            `  cohort_too_small   ${counts.cohort_too_small}\n` +
            `  not_implemented    ${counts.not_implemented}\n`,
    );
    if (counts.not_implemented > 0) {
        console.warn(
            `Warning: ${counts.not_implemented} aggregates are still stubs. ` +
                "Implement them in apps/webapp/scripts/state-of-em-2026/queries/ before publication.\n",
        );
    }
}

main().catch((err) => {
    console.error(
        "\nExtraction failed:\n",
        err instanceof Error ? err.stack ?? err.message : err,
        "\n",
    );
    process.exit(1);
});
