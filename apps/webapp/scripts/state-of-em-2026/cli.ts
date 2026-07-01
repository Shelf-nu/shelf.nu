/**
 * CLI argument parsing for the State of Equipment Management 2026
 * extraction script.
 *
 * Mirrors the convention used by `seed-reporting-demo/cli.ts` — a tiny
 * hand-written parser with explicit usage text, so the script has zero
 * external CLI-parsing deps and the data team can read the parser to
 * understand exactly what flags exist.
 *
 * @see ../README.md — full flag reference
 * @see ../state-of-em-2026.ts — entry point
 */

export class HelpRequested extends Error {
    constructor() {
        super("help requested");
    }
}

/**
 * Parsed CLI options. All flags have defaults so the script can be run
 * with no arguments during local development.
 */
export interface ExtractorCliOptions {
    /** Path to write the result JSON. */
    outputPath: string;
    /** Optional path to write a companion CSV of the published aggregates. */
    csvPath?: string;
    /** ISO 8601 start of the observation window (inclusive). */
    dataWindowStart: Date;
    /** ISO 8601 end of the observation window (inclusive). */
    dataWindowEnd: Date;
    /** Minimum assets per workspace for inclusion in the eligible cohort. */
    minAssets: number;
    /** Minimum cohort size for an aggregate to be reported (k-anonymity floor). */
    minCohortSize: number;
    /** Path to JSON file of org IDs to exclude (Shelf staff / demo workspaces). */
    internalAllowlistPath: string;
    /** Whether to run the pipeline without writing output. */
    dryRun: boolean;
    /** Required to run with NODE_ENV=production. */
    iKnowWhatImDoing: boolean;
    /**
     * Probe-only mode. Skips aggregate queries and writes a feature-adoption
     * probe to `<output-dir>/probe.json` so the data team can verify that
     * the v1.2 stat structure is defensible before queries are implemented.
     * See ./probe.ts.
     */
    probe: boolean;
}

export const USAGE = `
Usage: pnpm webapp:report:state-of-em-2026 [-- <flags>]

Flags:
  --output <path>             Output JSON path. Default: ./output/aggregates.json
  --csv <path>                Optional companion CSV path for publication.
  --data-window-start <date>  ISO 8601 (YYYY-MM-DD). Default: 2025-05-01
  --data-window-end <date>    ISO 8601 (YYYY-MM-DD). Default: 2026-04-30
  --min-assets <n>            Minimum assets per workspace. Default: 10
  --min-cohort-size <n>       K-anonymity floor. Default: 20
  --internal-allowlist <path> JSON file of org IDs to exclude.
                              Default: ./allowlist/internal-orgs.json
  --dry-run                   Run the pipeline without writing output.
  --probe                     Run only the feature-adoption probe.
                              Writes ./output/probe.json — no aggregates.
                              Use this FIRST to verify the v1.2 stat
                              structure is defensible against your data.
  --i-know-what-im-doing      Required for NODE_ENV=production.
  --help                      Print this usage and exit.

Examples:
  # Step 1 — probe feature adoption to know which stats survive v1.2:
  pnpm webapp:report:state-of-em-2026 -- --probe

  # Step 2 — dry run to verify cohort size and surface unimplemented queries:
  pnpm webapp:report:state-of-em-2026 -- --dry-run

  # Step 3 — full run to local file:
  pnpm webapp:report:state-of-em-2026 -- --output ./output/aggregates.json

  # Production run (with explicit acknowledgement):
  NODE_ENV=production pnpm webapp:report:state-of-em-2026 -- \\
      --output ./output/aggregates.json --i-know-what-im-doing
`.trim();

const DEFAULTS = {
    outputPath: "./output/aggregates.json",
    dataWindowStart: "2025-05-01",
    dataWindowEnd: "2026-04-30",
    minAssets: 10,
    minCohortSize: 20,
    internalAllowlistPath: "./allowlist/internal-orgs.json",
} as const;

/**
 * Parse argv into typed options. Throws HelpRequested for `--help`,
 * Error for malformed input.
 */
export function parseExtractorArgs(argv: string[]): ExtractorCliOptions {
    const result: ExtractorCliOptions = {
        outputPath: DEFAULTS.outputPath,
        dataWindowStart: parseDate(DEFAULTS.dataWindowStart, "--data-window-start"),
        dataWindowEnd: parseDate(DEFAULTS.dataWindowEnd, "--data-window-end"),
        minAssets: DEFAULTS.minAssets,
        minCohortSize: DEFAULTS.minCohortSize,
        internalAllowlistPath: DEFAULTS.internalAllowlistPath,
        dryRun: false,
        iKnowWhatImDoing: false,
        probe: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--help":
            case "-h":
                throw new HelpRequested();
            case "--output":
                result.outputPath = requireValue(argv, ++i, "--output");
                break;
            case "--csv":
                result.csvPath = requireValue(argv, ++i, "--csv");
                break;
            case "--data-window-start":
                result.dataWindowStart = parseDate(
                    requireValue(argv, ++i, "--data-window-start"),
                    "--data-window-start",
                );
                break;
            case "--data-window-end":
                result.dataWindowEnd = parseDate(
                    requireValue(argv, ++i, "--data-window-end"),
                    "--data-window-end",
                );
                break;
            case "--min-assets":
                result.minAssets = parsePositiveInt(
                    requireValue(argv, ++i, "--min-assets"),
                    "--min-assets",
                );
                break;
            case "--min-cohort-size":
                result.minCohortSize = parsePositiveInt(
                    requireValue(argv, ++i, "--min-cohort-size"),
                    "--min-cohort-size",
                );
                break;
            case "--internal-allowlist":
                result.internalAllowlistPath = requireValue(
                    argv,
                    ++i,
                    "--internal-allowlist",
                );
                break;
            case "--dry-run":
                result.dryRun = true;
                break;
            case "--probe":
                result.probe = true;
                break;
            case "--i-know-what-im-doing":
                result.iKnowWhatImDoing = true;
                break;
            default:
                throw new Error(`Unknown flag: ${arg}`);
        }
    }

    if (result.dataWindowEnd <= result.dataWindowStart) {
        throw new Error(
            "--data-window-end must be after --data-window-start.",
        );
    }

    return result;
}

/** Helper: pull the value following a flag, or throw if missing. */
function requireValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`Flag ${flag} requires a value.`);
    }
    return value;
}

/** Parse a YYYY-MM-DD string to a Date, throwing on malformed input. */
function parseDate(value: string, flag: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${flag} must be in YYYY-MM-DD format. Got: ${value}`);
    }
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
        throw new Error(`${flag} is not a valid date: ${value}`);
    }
    return d;
}

/** Parse a positive integer, throwing on malformed input. */
function parsePositiveInt(value: string, flag: string): number {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0 || String(n) !== value) {
        throw new Error(`${flag} must be a positive integer. Got: ${value}`);
    }
    return n;
}
