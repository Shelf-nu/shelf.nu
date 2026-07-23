/**
 * Database client factory for `@shelf/database`.
 *
 * Owns the single `PrismaClient` construction point shared by every consuming
 * app (webapp, background jobs, scripts). Extensions added here (dynamic
 * `findMany`, transient-error retry) apply uniformly to all consumers.
 *
 * This package cannot depend on `@shelf/webapp`'s `Logger`/`delay`/error
 * utilities (that would invert the dependency direction), so anything needed
 * for the retry behavior below (logging, delay, error-code classification)
 * is defined locally.
 *
 * @see apps/webapp/app/database/db.server.ts — thin re-export consumed by the webapp.
 */

import { Prisma, PrismaClient } from "@prisma/client";

export type ExtendedPrismaClient = ReturnType<typeof createDatabaseClient>;

/**
 * Transient Prisma error codes where the query **never reached the database**
 * — the client could not establish or hold a connection. Because no statement
 * was ever executed, these are safe to retry for **any** operation, reads and
 * writes alike (a retry cannot duplicate a write that never happened).
 *
 *  - `P1001`: Can't reach database server
 *  - `P1002`: The database server was reached but timed out (connect timeout)
 *
 * `PrismaClientInitializationError` (the lazy client failing to establish its
 * FIRST connection during a DB outage) also surfaces these codes — see
 * {@link getRetryableErrorCode}, which reads that error's `errorCode` field.
 */
const CONNECTION_ERROR_CODES = new Set(["P1001", "P1002"]);

/**
 * Transient Prisma error codes that can surface **after** a statement was
 * already sent to the server — so a mutation may already have been applied
 * when the error is raised. Safe to retry for idempotent **reads**, but NOT
 * for writes: retrying a `create`/`update`/`delete` here can duplicate a row
 * or re-apply a mutation. See the read/write gate in {@link withPrismaRetry}.
 *
 *  - `P1008`: Operations timed out
 *  - `P1017`: Server has closed the connection
 */
const IN_FLIGHT_ERROR_CODES = new Set(["P1008", "P1017"]);

/**
 * Every transient code this layer may retry (connection-level + in-flight).
 * Retry eligibility is further gated by operation type — connection-level
 * codes retry unconditionally, in-flight codes only for reads (see
 * {@link isRetryablePrismaError}).
 *
 * `P2024` (timed out fetching a connection from the pool) is DELIBERATELY
 * absent: pool exhaustion means the database is already saturated, and
 * retrying re-queues the same work onto an already-overloaded pool —
 * deepening the incident instead of recovering from it. Callers should let
 * `P2024` fail fast (it's mapped to a 503 at the app layer) rather than have
 * it retried here.
 *
 * @see apps/webapp/app/utils/error.ts `PRISMA_TRANSIENT_ERROR_CODES` — a
 * different list used for 5xx status-code mapping, which DOES include
 * `P2024`. Do not reuse that list for retry decisions.
 */
export const PRISMA_RETRYABLE_ERROR_CODES = new Set([
  ...CONNECTION_ERROR_CODES,
  ...IN_FLIGHT_ERROR_CODES,
]);

/**
 * Prisma model operations that only READ. A read never mutates state, so it is
 * safe to retry on the ambiguous {@link IN_FLIGHT_ERROR_CODES} (a re-run can't
 * duplicate anything). Any operation NOT in this set is treated as a write and
 * is only retried on the write-safe {@link CONNECTION_ERROR_CODES}.
 *
 * @see https://www.prisma.io/docs/orm/reference/prisma-client-reference#model-queries
 */
const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** Maximum number of retry attempts for a transient Prisma error. */
const MAX_RETRIES = 2;

/** Base backoff unit (ms); actual delay is `BASE_DELAY_MS * attempt`. */
const BASE_DELAY_MS = 500;

/**
 * Extracts a transient Prisma error code from an unknown thrown value, reading
 * BOTH shapes Prisma uses to report one:
 *
 *  - `PrismaClientKnownRequestError.code` — errors raised while executing a
 *    query against an already-open connection.
 *  - `PrismaClientInitializationError.errorCode` — errors raised while the
 *    lazy client establishes its FIRST connection. A DB outage at cold start
 *    or reconnection surfaces `P1001`/`P1002` HERE, on `errorCode`, never on
 *    `code` — so a predicate that only reads `code` silently fails to retry in
 *    exactly the startup/reconnection scenario the retry exists for.
 *
 * Deliberately structural (duck-typed) rather than `instanceof
 * Prisma.PrismaClientKnownRequestError` so plain mocked errors in tests are
 * recognized the same way.
 *
 * @param error - The unknown value thrown by a Prisma operation.
 * @returns the recognized transient code, or `null` if `error` isn't one.
 */
export function getRetryableErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "errorCode" in error &&
        typeof (error as { errorCode: unknown }).errorCode === "string"
      ? (error as { errorCode: string }).errorCode
      : null;
  if (code === null) {
    return null;
  }
  return PRISMA_RETRYABLE_ERROR_CODES.has(code) ? code : null;
}

/**
 * Reports whether an error should be retried, given whether the failed
 * operation was a read.
 *
 *  - Connection-level codes ({@link CONNECTION_ERROR_CODES}) → always
 *    retryable: the query never reached the database, so no write could have
 *    been applied.
 *  - In-flight codes ({@link IN_FLIGHT_ERROR_CODES}) → retryable ONLY for
 *    reads: a write may already have committed before the error surfaced, so
 *    retrying it could duplicate a row or re-apply a mutation.
 *
 * @param error - The unknown value thrown by a Prisma operation.
 * @param options.operationIsRead - `true` if the wrapped operation is one of
 *   {@link READ_OPERATIONS}. Writes pass `false` and skip in-flight retries.
 * @returns `true` if `error` should be retried for this operation.
 */
export function isRetryablePrismaError(
  error: unknown,
  { operationIsRead }: { operationIsRead: boolean }
): boolean {
  const code = getRetryableErrorCode(error);
  if (code === null) {
    return false;
  }
  if (CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  // Remaining codes are in-flight/ambiguous — only safe to retry for reads.
  return operationIsRead;
}

/**
 * Runs `operation`, retrying it when it throws a transient Prisma error that is
 * retryable for this operation (see {@link isRetryablePrismaError}). Uses a
 * linear backoff of `BASE_DELAY_MS * attempt` (500ms, then 1000ms) between
 * attempts. Non-retryable errors — `P2024` pool exhaustion, and the in-flight
 * codes `P1008`/`P1017` on a WRITE — rethrow immediately on the first failure,
 * exactly like a call with no wrapper.
 *
 * Extracted out of {@link createDatabaseClient}'s `$allOperations` extension
 * so the retry/backoff logic can be unit-tested without a real Prisma client
 * or database connection.
 *
 * @param operation - The Prisma operation to execute (and retry on failure).
 * @param options - Optional overrides.
 * @param options.operationIsRead - `true` when the wrapped operation only
 *   reads ({@link READ_OPERATIONS}), permitting retries on the ambiguous
 *   in-flight codes. Defaults to `false` (write-safe): an un-classified caller
 *   never risks re-applying a mutation, only the connection-level codes retry.
 * @param options.log - Called once per retry with a human-readable message.
 *   Defaults to `console.warn` (the package has no `Logger`; retries are
 *   infrequent so stdout is fine — it surfaces in Fly/Sentry logs).
 * @param options.delay - Called with the backoff duration (ms) and awaited
 *   before the next attempt. Defaults to a real `setTimeout`-based delay.
 * @returns The resolved value of `operation`.
 * @throws The final error, once retries are exhausted or the error isn't retryable.
 */
export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  options?: {
    operationIsRead?: boolean;
    log?: (message: string) => void;
    delay?: (ms: number) => Promise<void>;
  }
): Promise<T> {
  const operationIsRead = options?.operationIsRead ?? false;
  const log = options?.log ?? console.warn;
  const delay =
    options?.delay ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        isRetryablePrismaError(error, { operationIsRead }) &&
        attempt <= MAX_RETRIES
      ) {
        // Non-null: isRetryablePrismaError only returns true for a known code.
        const code = getRetryableErrorCode(error);
        const delayMs = BASE_DELAY_MS * attempt;
        log(
          `[db] transient Prisma error [${code}], retry ${attempt}/${MAX_RETRIES} in ${delayMs}ms`
        );
        await delay(delayMs);
        continue;
      }
      throw error;
    }
  }

  // Unreachable: the loop above always either returns or throws.
  throw new Error("Retry loop exited unexpectedly");
}

/**
 * Creates a new PrismaClient instance with custom extensions.
 * Each app should create its own singleton using this factory.
 *
 * Extensions applied (in order):
 * 1. `dynamicFindMany` — allows calling `findMany` generically across models.
 * 2. Transient-error retry — retries connection-level failures (see
 *    {@link PRISMA_RETRYABLE_ERROR_CODES}) on all models. Reads additionally
 *    retry the ambiguous in-flight codes; writes do not, to avoid re-applying
 *    a mutation that may already have committed (see {@link withPrismaRetry}).
 */
export function createDatabaseClient(url?: string) {
  const client = new PrismaClient(url ? { datasourceUrl: url } : undefined)
    .$extends({
      model: {
        $allModels: {
          dynamicFindMany<T>(this: T, options: Prisma.Args<T, "findMany">) {
            const ctx = Prisma.getExtensionContext(this) as any;
            return ctx.findMany(options);
          },
        },
      },
    })
    .$extends({
      query: {
        $allModels: {
          async $allOperations({ operation, args, query }) {
            return withPrismaRetry(() => query(args), {
              operationIsRead: READ_OPERATIONS.has(operation),
            });
          },
        },
      },
    });

  return client;
}
