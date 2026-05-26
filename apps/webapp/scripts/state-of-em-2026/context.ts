/**
 * Shared extractor context.
 *
 * Built once in the entry point and threaded into every query module. Keeps
 * each query function pure(ish) — it can read from the database via
 * `ctx.db`, restrict to the data window via `ctx.dataWindowStart/End`, and
 * scope to the eligible cohort via `ctx.eligibleOrgIds`.
 *
 * @see ./cohort.ts — how eligibleOrgIds is built
 * @see ./cli.ts — how options arrive
 */

import type { ExtendedPrismaClient } from "@shelf/database";

import type { ExtractorCliOptions } from "./cli";
import type { CohortSummary } from "./cohort";

export interface ExtractorContext {
    /** Database client. The script holds one connection for the whole run. */
    db: ExtendedPrismaClient;
    /** CLI options as parsed. */
    options: ExtractorCliOptions;
    /** Start of the data window (inclusive). */
    dataWindowStart: Date;
    /** End of the data window (inclusive). */
    dataWindowEnd: Date;
    /** K-anonymity floor (mirror of options.minCohortSize for ergonomics). */
    minCohortSize: number;
    /** Pre-computed list of eligible organization IDs. */
    eligibleOrgIds: string[];
    /** Summary of how the cohort was built — emitted with the output JSON. */
    cohortSummary: CohortSummary;
}
