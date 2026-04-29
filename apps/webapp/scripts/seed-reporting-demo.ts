/**
 * Reporting Demo Data Seeder (entry point)
 *
 * Fills a dedicated staging workspace with ~12 months of coherent historic
 * data — assets, bookings, audits, custody, kits, taxonomy, and the matching
 * `ActivityEvent` trail — so the reporting UI can render non-empty charts
 * and tables for all ten target reports (R1–R10, see
 * `CONTEXT-activity-event-next.md`).
 *
 * The script:
 * 1. Parses CLI flags (`--org-id`, `--dry-run`, `--seed`, `--i-know-what-im-doing`).
 * 2. Validates the target organization exists and is not already populated.
 * 3. Resolves real users + mints fake TeamMembers to build the `ActorPool`.
 * 4. Runs the phase generators in order, each mutating shared `SeederState`.
 * 5. Prints a summary and disconnects cleanly.
 *
 * Invocation (local dev):
 *   pnpm webapp:seed:reporting-demo -- --org-id <id> [--dry-run]
 *
 * Invocation (staging, from monorepo root):
 *   pnpm webapp:seed:reporting-demo:staging -- --org-id <id>
 *
 * Design notes:
 * - Uses `createDatabaseClient()` directly — the Remix-singleton wrapper at
 *   `app/database/db.server.ts` references browser globals and won't work
 *   in a plain Node script.
 * - All randomness flows through a seeded `faker` instance so runs are
 *   deterministic across machines given the same `--seed`.
 * - Phases 3–7 are wired as stubs here; each lands in its own commit to
 *   keep the diff reviewable.
 *
 * @see {@link file://./seed-reporting-demo/cli.ts} — argument parsing
 * @see {@link file://./seed-reporting-demo/context.ts} — shared context + state
 * @see {@link file://./seed-reporting-demo/actor-pool.ts} — who events attribute to
 * @see {@link file://./seed-reporting-demo/distributions.ts} — pareto / seasonality helpers
 * @see {@link file://./seed-reporting-demo/markers.ts} — seed-run identifiers for cleanup
 */

import { faker } from "@faker-js/faker";

import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

import {
  buildActorPool,
  type ActorPool,
} from "./seed-reporting-demo/actor-pool";
import {
  HelpRequested,
  parseSeederArgs,
  USAGE,
  type SeederCliOptions,
} from "./seed-reporting-demo/cli";
import {
  emptyState,
  type SeederContext,
  type SeederCounts,
  type SeederState,
} from "./seed-reporting-demo/context";
import { SEED_RUN_ID } from "./seed-reporting-demo/markers";
import { runAssetsPhase } from "./seed-reporting-demo/phases/assets";
import { runAuditsPhase } from "./seed-reporting-demo/phases/audits";
import { runBookingsPhase } from "./seed-reporting-demo/phases/bookings";
import { runCurrentStatePhase } from "./seed-reporting-demo/phases/current-state";
import { runKitsPhase } from "./seed-reporting-demo/phases/kits";
import { runTaxonomyPhase } from "./seed-reporting-demo/phases/taxonomy-and-team";

/**
 * Planned medium-scale targets. Adjust here to re-scale; phases use these
 * as the single source of truth for their row counts.
 */
export const SEED_TARGETS = {
  categories: 7,
  locations: 5,
  /** Includes the one marker tag. */
  tags: 10,
  customFields: 3,
  teamMembers: 18,
  assets: 300,
  kits: 15,
  bookings: 1_500,
  /** Subset of bookings that went through a partial-checkin step. */
  partialCheckinBookings: 75,
  auditSessions: 80,
  /** Rough; actual audit-asset rows depend on per-audit randomness. */
  approxAuditAssets: 2_500,
  /** Rough; actual events depend on branching in phases 5–7. */
  approxActivityEvents: 25_000,
} as const;

/** History window length — 12 months, matching the planned target. */
const HISTORY_MONTHS = 12;

/** Entry point — parses args, runs the seed, handles lifecycle + errors. */
async function main(): Promise<void> {
  let options: SeederCliOptions;
  try {
    options = parseSeederArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof HelpRequested) {
      console.log(USAGE);
      process.exit(0);
    }
    console.error(
      `\nError: ${err instanceof Error ? err.message : String(err)}\n`
    );
    console.error(USAGE);
    process.exit(1);
  }

  // Block production runs unless the operator explicitly opts in.
  if (process.env.NODE_ENV === "production" && !options.iKnowWhatImDoing) {
    console.error(
      "\nRefusing to run with NODE_ENV=production without --i-know-what-im-doing.\n" +
        "This seeder is for staging / dev only. If you truly intend this, pass the flag.\n"
    );
    process.exit(2);
  }

  // Seed faker so every subsequent call is deterministic across runs.
  faker.seed(options.seed);

  const db = createDatabaseClient();

  try {
    await db.$connect();

    const org = await validateOrganization(db, options.orgId);
    await assertNotAlreadyPopulated(db, options.orgId);

    printPlannedTargets(options, org.name);

    if (options.dryRun) {
      console.log("\n--dry-run passed: exiting without writing any rows.\n");
      return;
    }

    // Build the actor pool BEFORE phases — it creates the 18 fake TeamMembers
    // and resolves the 1–2 real-user actors, so every phase thereafter can
    // attribute events via `ctx.actors.pick(rng)`.
    console.log("Building actor pool (18 fake + real users)…");
    const actors = await buildActorPool(db, options.orgId);
    console.log(
      `  ${actors.real.length} real users + ${actors.fake.length} fake team members\n`
    );

    const state = emptyState();
    state.teamMemberIds = [
      ...actors.real.map((a) => a.teamMemberId),
      ...actors.fake.map((a) => a.teamMemberId),
    ];
    // Only the fakes count as "seeded" — the real users' TeamMembers already
    // existed before we ran.
    state.counts.teamMembers = actors.fake.length;

    const ctx = buildContext(db, options, actors);

    await runPhases(ctx, state);
    printSummary(state.counts);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Fetch the target organization and fail fast if it doesn't exist. Returning
 * the org lets callers reference its name in logs without re-querying.
 */
async function validateOrganization(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<{ id: string; name: string }> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    throw new Error(
      `Organization ${orgId} does not exist. Create it via the Shelf UI first, ` +
        "then re-run the seeder with its id."
    );
  }
  return org;
}

/**
 * Safety net: abort if the target org already holds a large amount of event
 * data. Prevents accidentally running the seeder against a real production-
 * like workspace. The threshold is intentionally generous (5k events) —
 * re-runs after a clean drop well below it.
 */
async function assertNotAlreadyPopulated(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<void> {
  const eventCount = await db.activityEvent.count({
    where: { organizationId: orgId },
  });
  if (eventCount > 5_000) {
    throw new Error(
      `Organization ${orgId} already has ${eventCount} ActivityEvent rows. ` +
        "This seeder is intended for empty/near-empty workspaces. If you truly " +
        "want to seed on top of existing data, clear it first with " +
        "`pnpm webapp:clean:reporting-demo`."
    );
  }
}

/**
 * Assemble the read-only seeder context. Owner userId is taken from the
 * actor pool's first real user — `buildActorPool` throws if none exists,
 * so this access is safe.
 */
function buildContext(
  db: ExtendedPrismaClient,
  options: SeederCliOptions,
  actors: ActorPool
): SeederContext {
  const now = new Date();
  const historyStart = new Date(now);
  historyStart.setMonth(historyStart.getMonth() - HISTORY_MONTHS);

  // Faker's mersenne-twister PRNG is seeded via `faker.seed()` above; we
  // expose it through an RNG function for the pure-math helpers.
  const rng = () => faker.number.float({ min: 0, max: 1 });

  return {
    db,
    orgId: options.orgId,
    ownerUserId: actors.real[0].userId!, // non-null by ActorPool contract
    now,
    historyStart,
    rng,
    actors,
  };
}

/**
 * Human-readable preview of what the seeder will insert. Printed before the
 * first write (and in full on `--dry-run`).
 */
function printPlannedTargets(options: SeederCliOptions, orgName: string): void {
  const mode = options.dryRun ? "DRY RUN" : "LIVE RUN";
  console.log(
    `\n=== Reporting-demo seeder (${SEED_RUN_ID}) — ${mode} ===\n` +
      `Target workspace:  ${orgName} (${options.orgId})\n` +
      `Faker seed:        ${options.seed}\n\n` +
      "Planned row counts:\n" +
      `  Categories         ${SEED_TARGETS.categories}\n` +
      `  Locations          ${SEED_TARGETS.locations}\n` +
      `  Tags               ${SEED_TARGETS.tags} (incl. marker tag)\n` +
      `  Custom Fields      ${SEED_TARGETS.customFields}\n` +
      `  Team Members       ${SEED_TARGETS.teamMembers}\n` +
      `  Assets             ${SEED_TARGETS.assets}\n` +
      `  Kits               ${SEED_TARGETS.kits}\n` +
      `  Bookings           ${SEED_TARGETS.bookings}\n` +
      `  Partial Check-ins  ${SEED_TARGETS.partialCheckinBookings}\n` +
      `  Audit Sessions     ${SEED_TARGETS.auditSessions}\n` +
      `  Audit Assets       ~${SEED_TARGETS.approxAuditAssets}\n` +
      `  Activity Events    ~${SEED_TARGETS.approxActivityEvents}\n`
  );
}

/**
 * Orchestrate each phase in order. Phases mutate `state` in place; the
 * orchestrator just logs progress and sequences them.
 */
async function runPhases(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  console.log(
    "Phase 2 — taxonomy (categories, locations, tags, custom fields)…"
  );
  await runTaxonomyPhase(ctx, state);
  console.log(
    `  ${state.counts.categories} categories, ${state.counts.locations} locations, ` +
      `${state.counts.tags} tags, ${state.counts.customFields} custom fields\n`
  );

  console.log("Phase 3 — assets with change history…");
  await runAssetsPhase(ctx, state);
  console.log(
    `  ${state.counts.assets} assets, ${state.counts.activityEvents} activity events so far\n`
  );

  console.log("Phase 4 — kits with asset membership…");
  await runKitsPhase(ctx, state);
  console.log(
    `  ${state.counts.kits} kits, ${state.counts.activityEvents} activity events so far\n`
  );

  console.log(
    "Phase 5 — bookings with Pareto popularity, seasonality, outcome mix…"
  );
  await runBookingsPhase(ctx, state);
  console.log(
    `  ${state.counts.bookings} bookings, ${state.counts.partialCheckins} partial check-ins, ` +
      `${state.counts.activityEvents} activity events so far\n`
  );

  console.log("Phase 6 — audit sessions with scan trails…");
  await runAuditsPhase(ctx, state);
  console.log(
    `  ${state.counts.auditSessions} audits, ${state.counts.auditAssets} audit assets, ` +
      `${state.counts.auditScans} scans, ${state.counts.activityEvents} activity events so far\n`
  );

  console.log("Phase 7 — current-state reconciliation (custody)…");
  await runCurrentStatePhase(ctx, state);
  console.log(
    `  ${state.counts.custodies} current custodies, ${state.counts.activityEvents} activity events total\n`
  );
}

/** Final report printed after a successful live run. */
function printSummary(counts: SeederCounts): void {
  console.log("\n=== Summary: rows inserted ===");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(
    "\nSeeder failed:\n",
    err instanceof Error ? err.stack ?? err.message : err,
    "\n"
  );
  process.exit(1);
});
