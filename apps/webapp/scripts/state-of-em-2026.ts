/**
 * State of Equipment Management 2026 — Aggregate Extraction
 *
 * Entry point for the script that produces the anonymized aggregates
 * feeding the public report on shelf.nu/reports/state-of-equipment-
 * management-2026.
 *
 * The script:
 * 1. Parses CLI args (data window, output path, dry-run, internal allowlist).
 * 2. Builds an eligible-workspace cohort per the report's published
 *    methodology (Team-tier, not disabled, owner not deleted, >= 10 assets).
 * 3. Runs each query module against that cohort — visibility, bookings,
 *    custody, audits, cost-of-disorder, industries, top-performer patterns.
 * 4. Applies the anonymization layer (k-anonymity floor + sig-fig rounding).
 * 5. Writes a single JSON file the marketing team copies into the
 *    website-v2 repo's typed data file.
 *
 * Invocation:
 *   pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json
 *
 * Production guard:
 *   Refuses to run with NODE_ENV=production unless --i-know-what-im-doing
 *   is passed, mirroring seed-reporting-demo.ts.
 *
 * @see ./state-of-em-2026/README.md — workflow for the data team
 * @see ./state-of-em-2026/methodology.md — methodology (mirrored in the report)
 * @see ./state-of-em-2026/cli.ts — argument parsing
 * @see ./state-of-em-2026/cohort.ts — eligibility filter
 * @see ./state-of-em-2026/anonymize.ts — k-anonymity + rounding
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

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
import { runBookingsQueries } from "./state-of-em-2026/queries/bookings";
import { runCustodyQueries } from "./state-of-em-2026/queries/custody";
import { runAuditsQueries } from "./state-of-em-2026/queries/audits";
import { runDisorderQueries } from "./state-of-em-2026/queries/disorder";
import { runIndustryQueries } from "./state-of-em-2026/queries/industries";
import { runTopPerformerQueries } from "./state-of-em-2026/queries/top-performers";

/** Stable identifier for this dataset — matches website frontmatter. */
const DATASET_KEY = "soem-2026-v1";
/** Methodology version — bump in lockstep with ./state-of-em-2026/methodology.md */
const METHODOLOGY_VERSION = "1.0";
/** Script version for output traceability. Bump on any logic change. */
const SCRIPT_VERSION = "0.1.0";

/** Entry point. */
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

        // 3. Run every query section. Each function merges into `output.aggregates`.
        await runSection("Visibility", () => runVisibilityQueries(db, ctx), output);
        await runSection("Bookings", () => runBookingsQueries(db, ctx), output);
        await runSection("Custody", () => runCustodyQueries(db, ctx), output);
        await runSection("Audits", () => runAuditsQueries(db, ctx), output);
        await runSection("Cost of disorder", () => runDisorderQueries(db, ctx), output);
        await runSection("Top-performer patterns", () => runTopPerformerQueries(db, ctx), output);

        // 4. Industry cuts — these merge into output.industries instead.
        console.log("\nRunning industry cuts…");
        output.industries = await runIndustryQueries(db, ctx);
        console.log(`  ${Object.keys(output.industries).length} industries reported.`);

        // 5. Defense-in-depth: strip raw values before writing.
        for (const key of Object.keys(output.aggregates)) {
            output.aggregates[key] = stripRawValues(output.aggregates[key]);
        }
        for (const industryKey of Object.keys(output.industries)) {
            const cut = output.industries[industryKey];
            for (const key of Object.keys(cut.aggregates)) {
                cut.aggregates[key] = stripRawValues(cut.aggregates[key]);
            }
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

        // 8. (Optional) CSV companion. Skipped for v1 — the data team
        // can add this once they decide on the schema. The flag is parsed
        // so the orchestrator doesn't have to change when CSV is added.
        if (options.csvPath) {
            console.warn(
                `\nNote: --csv was passed (${options.csvPath}) but CSV emission is not yet implemented.\n` +
                    "See state-of-em-2026/output-schema.ts to add it.\n",
            );
        }
    } finally {
        await db.$disconnect();
    }
}

/**
 * Helper: parse CLI args, exit cleanly on --help or parse errors.
 */
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

/**
 * Helper: run one query section and merge its results into the output.
 * Wraps the call in error handling so a single failing query doesn't abort
 * the entire extraction — the failing aggregates become `not_implemented`
 * sentinels in the output.
 */
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
        // Don't rethrow — keep going so the data team sees the full picture
        // of what's implemented and what's not on a dry run.
    }
}

/** Helper: write the output JSON, creating the parent directory if needed. */
async function writeOutput(
    output: ExtractorOutput,
    path: string,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(output, null, 2) + "\n", "utf8");
}

/** Print a header at the start of the run. */
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
            `Script:          v${SCRIPT_VERSION}\n`,
    );
}

/** Tally and print the status of every aggregate. */
function printStatusSummary(output: ExtractorOutput): void {
    const counts = { ok: 0, cohort_too_small: 0, not_implemented: 0 };
    for (const agg of Object.values(output.aggregates)) {
        counts[agg.status] += 1;
    }
    for (const industry of Object.values(output.industries)) {
        for (const agg of Object.values(industry.aggregates)) {
            counts[agg.status] += 1;
        }
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
