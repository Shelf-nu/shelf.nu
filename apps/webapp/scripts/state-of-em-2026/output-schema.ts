/**
 * Output JSON schema for the State of Equipment Management 2026 extraction.
 *
 * The script writes exactly one file matching this shape. The website-v2
 * data file (`src/data/state-of-equipment-management-2026.ts`) consumes
 * matching keys. If a key is added here, add it to the website data file
 * (and to the report MDX where it's referenced) in the same change.
 *
 * @see ../README.md — workflow for transferring values into the website
 * @see https://github.com/Shelf-nu/website-v2/blob/main/src/data/state-of-equipment-management-2026.ts
 */

import type { ReportableAggregate } from "./anonymize";
import type { CohortSummary } from "./cohort";

/** Top-level output written to the file passed via `--output`. */
export interface ExtractorOutput {
    /** Metadata that travels with the dataset. */
    metadata: ExtractorMetadata;
    /** Cohort summary for transparency — published in the report's methodology. */
    cohort: CohortSummary;
    /** All aggregates, keyed by stable identifier. */
    aggregates: Record<string, ReportableAggregate>;
    /** Per-industry aggregates (Education, IT, Media, Construction, etc.). */
    industries: Record<string, IndustryCut>;
}

export interface ExtractorMetadata {
    /** Stable report identifier. Mirrors `datasetKey` in the website frontmatter. */
    datasetKey: string;
    /** Methodology version this output was produced under. */
    methodologyVersion: string;
    /** ISO 8601 start of the observation window. */
    dataWindowStart: string;
    /** ISO 8601 end of the observation window. */
    dataWindowEnd: string;
    /** ISO 8601 timestamp the script ran. */
    extractedAt: string;
    /** Script version (read from package.json or hardcoded). */
    scriptVersion: string;
}

export interface IndustryCut {
    industry: string;
    cohortSize: number;
    aggregates: Record<string, ReportableAggregate>;
}

/** Convenient type alias for a query function's return shape. */
export type QueryResult = Record<string, ReportableAggregate>;

/** Build an empty output skeleton, ready for query results to be merged in. */
export function buildEmptyOutput(opts: {
    datasetKey: string;
    methodologyVersion: string;
    dataWindowStart: Date;
    dataWindowEnd: Date;
    scriptVersion: string;
    cohort: CohortSummary;
}): ExtractorOutput {
    return {
        metadata: {
            datasetKey: opts.datasetKey,
            methodologyVersion: opts.methodologyVersion,
            dataWindowStart: opts.dataWindowStart.toISOString(),
            dataWindowEnd: opts.dataWindowEnd.toISOString(),
            extractedAt: new Date().toISOString(),
            scriptVersion: opts.scriptVersion,
        },
        cohort: opts.cohort,
        aggregates: {},
        industries: {},
    };
}
