/**
 * Fixture-DB accessor for real-database smoke and parity tests.
 *
 * The advanced-index streaming rebuild replaces the mega-LATERAL hydration with
 * narrow batched queries and raw SQL. Raw SQL is opaque to the type-checker
 * (`@map` column names, `json_agg` shapes, COALESCE), so every batch and the
 * critical-page query is validated against a REAL Postgres holding realistic
 * data — not a mock. This module is the single point tests reach that database
 * through.
 *
 * The database is supplied out-of-band via `FIXTURE_DATABASE_URL` (a staging
 * dump restored into a local, **read-only** Postgres). When that variable is
 * absent — the default on a fresh checkout and in CI until the fixture is
 * provisioned — {@link FIXTURE_DB_AVAILABLE} is `false` and real-DB tests
 * self-skip with `it.skipIf(!FIXTURE_DB_AVAILABLE)`, so the suite stays green
 * without the fixture. The Task-10 parity RELEASE gate is the one exception: it
 * must FAIL (not skip) when the fixture is missing, so a release can never pass
 * parity by silently skipping it.
 *
 * Read-only enforcement lives at the database/role level (documented in
 * `fixture-db.md`), never in this client — a client-side guard would be trivial
 * to bypass and gives false assurance. The role restore/setup is owned by the
 * operator; this module only connects.
 *
 * @see apps/webapp/test/tooling/fixture-db.md — operator runbook (restore, role, verify)
 * @see superpowers/2026-08-26-advanced-index-streaming-rebuild-plan.md — Task 3
 */
import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

/** Trimmed `FIXTURE_DATABASE_URL`, or `""` when unset/blank. */
const FIXTURE_DATABASE_URL = (process.env.FIXTURE_DATABASE_URL ?? "").trim();

/**
 * Whether a fixture database is configured for this run.
 *
 * Use as the predicate for `it.skipIf(!FIXTURE_DB_AVAILABLE)` so real-DB tests
 * skip cleanly when no fixture is provisioned. The release parity gate reads the
 * same flag but throws instead of skipping.
 */
export const FIXTURE_DB_AVAILABLE = FIXTURE_DATABASE_URL !== "";

/** Lazily-constructed, process-shared client — one connection pool per run. */
let cached: ExtendedPrismaClient | undefined;

/**
 * Returns the shared Prisma client pointed at the fixture database.
 *
 * Lazy and memoized: the first call constructs the client against
 * `FIXTURE_DATABASE_URL`; later calls reuse it, so a whole test file shares one
 * pool. Callers must gate on {@link FIXTURE_DB_AVAILABLE} first; calling this
 * without a configured fixture throws rather than silently falling back to the
 * app's own `DATABASE_URL` (which would run "read-only" tests against a
 * writable dev database).
 *
 * @returns the fixture-scoped {@link ExtendedPrismaClient}
 * @throws {Error} when `FIXTURE_DATABASE_URL` is unset or blank
 */
export function getFixtureDb(): ExtendedPrismaClient {
  if (!FIXTURE_DB_AVAILABLE) {
    throw new Error(
      "getFixtureDb() called without FIXTURE_DATABASE_URL set. Gate real-DB " +
        "tests on FIXTURE_DB_AVAILABLE (it.skipIf(!FIXTURE_DB_AVAILABLE)). See " +
        "apps/webapp/test/tooling/fixture-db.md."
    );
  }
  if (!cached) {
    cached = createDatabaseClient(FIXTURE_DATABASE_URL);
  }
  return cached;
}
