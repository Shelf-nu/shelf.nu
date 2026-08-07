/**
 * Output JSON schema for the State of Equipment Management 2026 extraction.
 *
 * The script writes exactly one file matching this shape. The website-v2
 * data file (`src/data/state-of-equipment-management-2026.ts`) consumes
 * matching keys.
 *
 * Scope note: in v1 the report pivoted to a single-headline structure
 * (ghost-assets-in-dollars). The output schema is unchanged — it remains
 * a flat key/value map of aggregates plus optional per-industry cuts —
 * but the orchestrator calls fewer query modules. The schema is stable
 * so the script and the website data file remain decoupled.
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
    /** Per-industry aggregates. Empty {} in v1 (industries deferred to 2027). */
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
    /** Script version (bumped on any logic change). */
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
