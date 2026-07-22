/**
 * Tests for the Prisma transient-error retry wrapper in `client.ts`.
 *
 * Run with `pnpm --filter @shelf/database test` (Node's built-in test
 * runner via `tsx`, already a package devDependency — no vitest/harness
 * needed for this small, dependency-free package).
 *
 * These tests never touch a real database: the "query" is a plain mock
 * function that throws/resolves on cue.
 *
 * @see ./client.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isRetryablePrismaError,
  PRISMA_RETRYABLE_ERROR_CODES,
  withPrismaRetry,
} from "./client";

/**
 * Builds a Prisma-shaped error (a plain object carrying a `code`), the same
 * shape `Prisma.PrismaClientKnownRequestError` instances have at runtime.
 *
 * why: constructing the real `PrismaClientKnownRequestError` requires
 * private constructor args tied to an engine version; a plain object with
 * `.code` is exactly what `isRetryablePrismaError`'s structural check reads,
 * so it exercises the same code path without an engine dependency.
 */
function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`mock prisma error ${code}`), { code });
}

/**
 * Type-safe check for "did this rejection carry the given Prisma error
 * code", used as the matcher argument to `assert.rejects`. Avoids narrowing
 * through `instanceof Error` (which doesn't know about `.code`) and avoids
 * `any` — mirrors the structural check `isRetryablePrismaError` itself uses.
 */
function rejectedWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

test("isRetryablePrismaError", async (t) => {
  await t.test("returns true for every retryable code", () => {
    for (const code of PRISMA_RETRYABLE_ERROR_CODES) {
      assert.equal(isRetryablePrismaError(prismaError(code)), true);
    }
  });

  await t.test("returns false for P2024 (pool exhaustion)", () => {
    assert.equal(isRetryablePrismaError(prismaError("P2024")), false);
  });

  await t.test("returns false for a non-Prisma error (no code)", () => {
    assert.equal(isRetryablePrismaError(new Error("boom")), false);
  });

  await t.test("returns false for non-object thrown values", () => {
    assert.equal(isRetryablePrismaError("just a string"), false);
    assert.equal(isRetryablePrismaError(null), false);
    assert.equal(isRetryablePrismaError(undefined), false);
  });
});

test("withPrismaRetry", async (t) => {
  await t.test(
    "retries a P1017 error and returns the eventual success",
    async () => {
      let calls = 0;
      const delays: number[] = [];
      const logs: string[] = [];

      const result = await withPrismaRetry(
        async () => {
          calls += 1;
          if (calls === 1) throw prismaError("P1017");
          return "ok";
        },
        {
          // why: skip the real setTimeout-based backoff so the test runs
          // instantly instead of waiting out the 500ms/1000ms delays.
          delay: async (ms) => {
            delays.push(ms);
          },
          log: (message) => logs.push(message),
        }
      );

      assert.equal(result, "ok");
      assert.equal(calls, 2);
      assert.deepEqual(delays, [500]);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /P1017/);
      assert.match(logs[0], /retry 1\/2/);
    }
  );

  await t.test(
    "does NOT retry P2024 (pool exhaustion) — throws immediately",
    async () => {
      let calls = 0;
      const logs: string[] = [];

      await assert.rejects(
        () =>
          withPrismaRetry(
            async () => {
              calls += 1;
              throw prismaError("P2024");
            },
            { log: (message) => logs.push(message) }
          ),
        (error: unknown) => rejectedWithCode(error, "P2024")
      );

      assert.equal(calls, 1, "P2024 must fail fast, never retried");
      assert.equal(
        logs.length,
        0,
        "no retry log line for a non-retryable error"
      );
    }
  );

  await t.test(
    "does not retry a non-Prisma error — throws immediately",
    async () => {
      let calls = 0;

      await assert.rejects(
        () =>
          withPrismaRetry(async () => {
            calls += 1;
            throw new Error("totally unrelated failure");
          }),
        /totally unrelated failure/
      );

      assert.equal(calls, 1);
    }
  );

  await t.test(
    "throws the final error once retries are exhausted",
    async () => {
      let calls = 0;
      const delays: number[] = [];

      await assert.rejects(
        () =>
          withPrismaRetry(
            async () => {
              calls += 1;
              throw prismaError("P1001");
            },
            {
              delay: async (ms) => {
                delays.push(ms);
              },
              log: () => {},
            }
          ),
        (error: unknown) => rejectedWithCode(error, "P1001")
      );

      // MAX_RETRIES = 2 -> 3 total attempts, 2 backoff delays (500ms, 1000ms).
      assert.equal(calls, 3);
      assert.deepEqual(delays, [500, 1000]);
    }
  );

  await t.test("returns immediately on first-try success", async () => {
    let calls = 0;
    const result = await withPrismaRetry(async () => {
      calls += 1;
      return 42;
    });
    assert.equal(result, 42);
    assert.equal(calls, 1);
  });
});
