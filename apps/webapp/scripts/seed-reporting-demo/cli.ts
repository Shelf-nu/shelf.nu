/**
 * CLI argument parsing for the reporting-demo seeder.
 *
 * Small, dependency-free parser tailored to this script's flags — we avoid
 * pulling in `yargs`/`commander` since the surface is tiny and validation
 * can be specific to our needs.
 */

/** Parsed, validated CLI options for the seeder. */
export type SeederCliOptions = {
  /** Target organization id — required. Seeder only writes into this org. */
  orgId: string;
  /** When true, prints the planned per-entity row counts and exits without writing. */
  dryRun: boolean;
  /** RNG seed for faker + internal PRNG. Same seed → same output. */
  seed: number;
  /** Explicit acknowledgement required to run against a NODE_ENV=production DB. */
  iKnowWhatImDoing: boolean;
};

/**
 * Parse argv into `SeederCliOptions`, throwing a descriptive `Error` on any
 * problem. Callers are expected to print the error message and exit with
 * non-zero status — we keep exit codes in the orchestrator for testability.
 *
 * @param argv - Typically `process.argv.slice(2)`.
 * @returns Parsed + validated options.
 * @throws {Error} If `--org-id` is missing or an unknown flag is passed.
 */
export function parseSeederArgs(argv: readonly string[]): SeederCliOptions {
  let orgId: string | undefined;
  let dryRun = false;
  let seed = 42;
  let iKnowWhatImDoing = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--org-id": {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("--org-id requires a value (e.g. `--org-id clx...`)");
        }
        orgId = next;
        i++;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--seed": {
        const next = argv[i + 1];
        const parsed = next ? Number.parseInt(next, 10) : Number.NaN;
        if (!Number.isFinite(parsed)) {
          throw new Error("--seed requires an integer value");
        }
        seed = parsed;
        i++;
        break;
      }
      case "--i-know-what-im-doing":
        iKnowWhatImDoing = true;
        break;
      case "--help":
      case "-h":
        throw new HelpRequested();
      case "--":
        // POSIX-style separator — pnpm passes it through when invoked as
        // `pnpm run script -- --flag`. Ignore silently.
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!orgId) {
    throw new Error("--org-id is required");
  }

  return { orgId, dryRun, seed, iKnowWhatImDoing };
}

/**
 * Thrown by `parseSeederArgs` when the user passes `--help` / `-h`. Lets the
 * orchestrator print usage and exit 0 rather than treating it as an error.
 */
export class HelpRequested extends Error {
  constructor() {
    super("help requested");
    this.name = "HelpRequested";
  }
}

/** Multi-line usage text printed on `--help` or on a parsing error. */
export const USAGE = `
Usage:
  pnpm webapp:seed:reporting-demo -- --org-id <id> [--dry-run] [--seed <n>]

Required:
  --org-id <id>           Target organization id. Must already exist.
                          The seeder never writes outside this org.

Optional:
  --dry-run               Print the planned per-table row counts and exit
                          without writing. Safe to run anytime.
  --seed <n>              Integer RNG seed (default 42). Same seed → same rows.
  --i-know-what-im-doing  Required to run against NODE_ENV=production.
  --help, -h              Show this help.
`.trim();
