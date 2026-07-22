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
 * Prisma error codes that indicate a transient, connection-level failure —
 * the client could not establish or hold a connection to the database — as
 * opposed to the query itself being invalid or the data not existing. These
 * are safe to retry because the query almost certainly never reached the
 * database.
 *
 * `P2024` (timed out fetching a connection from the pool) is DELIBERATELY
 * excluded: pool exhaustion means the database is already saturated, and
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
  "P1001", // Can't reach database server
  "P1002", // The database server was reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
]);

/** Maximum number of retry attempts for a transient Prisma error. */
const MAX_RETRIES = 2;

/** Base backoff unit (ms); actual delay is `BASE_DELAY_MS * attempt`. */
const BASE_DELAY_MS = 500;

/**
 * Narrows an unknown thrown value to a Prisma-style error carrying a string
 * `code`, and reports whether that code is one of
 * {@link PRISMA_RETRYABLE_ERROR_CODES}.
 *
 * Deliberately checks structurally (`"code" in error`) rather than
 * `instanceof Prisma.PrismaClientKnownRequestError` so that plain mocked
 * errors in tests are also recognized correctly.
 *
 * @param error - The unknown value thrown by a Prisma query.
 * @returns `true` if `error` should be retried.
 */
export function isRetryablePrismaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const { code } = error as { code: unknown };
  return typeof code === "string" && PRISMA_RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Runs `operation`, retrying it when it throws a transient, connection-level
 * Prisma error (see {@link isRetryablePrismaError}). Uses a linear backoff of
 * `BASE_DELAY_MS * attempt` (500ms, then 1000ms) between attempts.
 * Non-retryable errors — including `P2024` pool exhaustion — rethrow
 * immediately on the first failure, exactly like a call with no wrapper.
 *
 * Extracted out of {@link createDatabaseClient}'s `$allOperations` extension
 * so the retry/backoff logic can be unit-tested without a real Prisma client
 * or database connection.
 *
 * @param operation - The Prisma operation to execute (and retry on failure).
 * @param options - Optional overrides, used by tests to avoid real delays
 *   and to assert on the retry log line without polluting stdout.
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
    log?: (message: string) => void;
    delay?: (ms: number) => Promise<void>;
  }
): Promise<T> {
  const log = options?.log ?? console.warn;
  const delay =
    options?.delay ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (isRetryablePrismaError(error) && attempt <= MAX_RETRIES) {
        const code = (error as { code: string }).code;
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
 *    {@link PRISMA_RETRYABLE_ERROR_CODES}) across all operations, on all models.
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
          async $allOperations({ args, query }) {
            return withPrismaRetry(() => query(args));
          },
        },
      },
    });

  return client;
}
