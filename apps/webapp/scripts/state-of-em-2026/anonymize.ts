/**
 * Anonymization layer — k-anonymity floor + significant-figure rounding.
 *
 * The two safety controls that every aggregate must pass through before
 * landing in the output JSON. Together they ensure no individual workspace
 * is identifiable and no number leaks excessive precision.
 *
 * @see ../methodology.md — published methodology, anonymization section
 */

/**
 * Status flag attached to each aggregate in the output. `ok` means the
 * aggregate was computed and passes the cohort-size floor; `cohort_too_small`
 * means the underlying cohort was below `minCohortSize` and the value has
 * been nulled. The report's MDX should treat `cohort_too_small` aggregates
 * as "not reportable" and omit them from the published text.
 */
export type AggregateStatus =
    | "ok"
    | "cohort_too_small"
    | "not_implemented";

/**
 * Wrapper type returned by every query function. The orchestrator collects
 * these into the final output JSON.
 */
export interface ReportableAggregate {
    key: string;
    label: string;
    /** Rounded value, or null when cohort_too_small / not_implemented. */
    value: number | null;
    /** The unrounded value, kept for debugging. NEVER include in published output. */
    rawValue?: number;
    /** Cohort size the aggregate was computed over. */
    cohortSize: number;
    /** Status flag. */
    status: AggregateStatus;
    /** Optional unit suffix for display (e.g. "%", " days"). */
    unit?: string;
}

/**
 * Round to one significant figure. Standard rule for published industry
 * aggregates so the figure doesn't appear spuriously precise.
 *
 * Examples:
 *   roundToOneSigFig(3047) === 3000
 *   roundToOneSigFig(0.34) === 0.3
 *   roundToOneSigFig(72)   === 70
 *   roundToOneSigFig(0)    === 0
 */
export function roundToOneSigFig(n: number): number {
    if (n === 0 || !Number.isFinite(n)) return n;
    const sign = Math.sign(n);
    const absN = Math.abs(n);
    const magnitude = Math.pow(10, Math.floor(Math.log10(absN)));
    return sign * Math.round(absN / magnitude) * magnitude;
}

/**
 * Round to a specific number of significant figures. Use this if a single
 * stat genuinely benefits from extra precision (e.g. a percentage where one
 * sig fig collapses 17% and 23% into the same number).
 *
 * USE SPARINGLY. The default is one sig fig for a reason.
 */
export function roundToSigFigs(n: number, sigFigs: number): number {
    if (n === 0 || !Number.isFinite(n)) return n;
    if (sigFigs <= 0) {
        throw new Error(`sigFigs must be >= 1, got: ${sigFigs}`);
    }
    const sign = Math.sign(n);
    const absN = Math.abs(n);
    const magnitude = Math.pow(10, Math.floor(Math.log10(absN)) - (sigFigs - 1));
    return sign * Math.round(absN / magnitude) * magnitude;
}

/**
 * Wrap a computed numerical aggregate with the k-anonymity check and
 * sig-fig rounding. The returned object is ready to embed in the output
 * JSON.
 *
 * Use this for EVERY aggregate. Never write a raw `{ value, cohortSize }`
 * directly to output — the wrapper enforces the safety policy.
 */
export function reportable(opts: {
    key: string;
    label: string;
    rawValue: number;
    cohortSize: number;
    minCohortSize: number;
    unit?: string;
    /** Override the default 1-sig-fig rounding (rarely needed; document why). */
    sigFigs?: number;
}): ReportableAggregate {
    const meetsFloor = opts.cohortSize >= opts.minCohortSize;
    const value = meetsFloor
        ? opts.sigFigs && opts.sigFigs !== 1
            ? roundToSigFigs(opts.rawValue, opts.sigFigs)
            : roundToOneSigFig(opts.rawValue)
        : null;

    return {
        key: opts.key,
        label: opts.label,
        value,
        rawValue: opts.rawValue,
        cohortSize: opts.cohortSize,
        status: meetsFloor ? "ok" : "cohort_too_small",
        ...(opts.unit ? { unit: opts.unit } : {}),
    };
}

/**
 * Helper for stubbed queries — returns an aggregate with `not_implemented`
 * status so the orchestrator can run end-to-end and surface what's missing.
 */
export function notImplementedAggregate(opts: {
    key: string;
    label: string;
    unit?: string;
}): ReportableAggregate {
    return {
        key: opts.key,
        label: opts.label,
        value: null,
        cohortSize: 0,
        status: "not_implemented",
        ...(opts.unit ? { unit: opts.unit } : {}),
    };
}

/**
 * Strip raw values before writing the output JSON. Defense-in-depth: even
 * if a query module forgets to drop the raw value, the orchestrator wipes
 * them before publication.
 */
export function stripRawValues(
    agg: ReportableAggregate,
): Omit<ReportableAggregate, "rawValue"> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { rawValue: _unused, ...rest } = agg;
    return rest;
}
