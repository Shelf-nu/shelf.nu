/**
 * Real-database test client
 *
 * Gives `*.db.test.ts` files a Prisma client bound to `TEST_DATABASE_URL`
 * plus two transaction helpers:
 *
 * - {@link withRollback} runs a callback inside a transaction and always
 *   rolls it back, so a test can write freely and leave nothing behind.
 * - {@link commitAndExpect} runs a callback inside a transaction that really
 *   commits, so DEFERRABLE INITIALLY DEFERRED constraint triggers fire and
 *   their errors surface as a value instead of a thrown exception.
 *
 * Every entry point refuses a database whose name does not end in `_test`,
 * so a misconfigured URL can never point these helpers at a dev or
 * production database.
 *
 * @see {@link file://./global-setup.ts} migrates the database before the run.
 * @see {@link file://./../../vitest.db.config.ts} the Vitest config that runs these tests.
 */

import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

/** The transaction client handed to callbacks of `$transaction`. */
export type TxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>;

/** Suffix a database name must carry before the harness touches it. */
const TEST_DATABASE_SUFFIX = "_test";

/**
 * Reads and validates `TEST_DATABASE_URL`.
 *
 * @returns The connection string, guaranteed to name a `*_test` database.
 * @throws {Error} When the variable is missing, is not a valid URL, or names a
 *   database whose name does not end in `_test`.
 */
export function readTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Real-database tests need a throwaway " +
        "database whose name ends in _test, for example " +
        "postgresql://postgres:postgres@localhost:5432/shelf_test"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL.");
  }

  // The path of a Postgres URL is `/<database>`; query params are separate.
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run real-database tests against "${databaseName}": the ` +
        `database name in TEST_DATABASE_URL must end in "${TEST_DATABASE_SUFFIX}".`
    );
  }

  return raw;
}

/** Lazily created client shared by every test in one worker. */
let testDb: ExtendedPrismaClient | undefined;

/**
 * Returns the Prisma client bound to `TEST_DATABASE_URL`, creating it on the
 * first call. Uses the same `createDatabaseClient` factory as the app, so
 * tests exercise the same client extensions production does.
 *
 * @returns The shared test client.
 * @throws {Error} When `TEST_DATABASE_URL` fails {@link readTestDatabaseUrl}.
 */
export function getTestDb(): ExtendedPrismaClient {
  if (!testDb) {
    testDb = createDatabaseClient(readTestDatabaseUrl());
  }
  return testDb;
}

/**
 * Thrown at the end of {@link withRollback} to make Prisma roll the
 * transaction back. Carries the callback's value so it can be returned.
 */
class RollbackSentinel<T> extends Error {
  constructor(readonly value: T) {
    super("withRollback: intentional rollback");
  }
}

/**
 * Runs `fn` inside a transaction and rolls the transaction back afterwards,
 * whether `fn` succeeds or throws. Deferred constraint triggers never fire,
 * because the transaction never commits: use {@link commitAndExpect} to test
 * those.
 *
 * @param fn - Test body; receives the transaction client.
 * @returns Whatever `fn` returned.
 * @throws Whatever `fn` threw (the transaction is rolled back either way).
 */
export async function withRollback<T>(
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  try {
    await getTestDb().$transaction(
      async (tx) => {
        const value = await fn(tx);
        throw new RollbackSentinel(value);
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    if (error instanceof RollbackSentinel) {
      return error.value as T;
    }
    throw error;
  }
  // Unreachable: the transaction callback always throws.
  throw new Error("withRollback: transaction committed unexpectedly");
}

/** Outcome of {@link commitAndExpect}. */
export type CommitResult = { ok: true } | { ok: false; message: string };

/**
 * Runs `fn` inside a transaction that really commits. Errors raised while
 * `fn` runs, and errors raised at COMMIT by deferred constraint triggers, are
 * returned as `{ ok: false, message }` so a test can assert on them.
 *
 * Rows written by a successful call stay in the database: the caller cleans
 * them up, or uses unique values so reruns do not collide.
 *
 * @param fn - Writes to commit; receives the transaction client.
 * @returns `{ ok: true }` when the transaction committed, otherwise the error
 *   message.
 */
export async function commitAndExpect(
  fn: (tx: TxClient) => Promise<void>
): Promise<CommitResult> {
  try {
    await getTestDb().$transaction(fn, { timeout: 30_000 });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Disconnects the shared client. Call from `afterAll` in a test file so the
 * worker does not hold the connection open.
 */
export async function disconnectTestDb(): Promise<void> {
  if (testDb) {
    await testDb.$disconnect();
    testDb = undefined;
  }
}
