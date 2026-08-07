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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  getRetryableErrorCode,
  isLockTableExhaustionError,
  isRetryablePrismaError,
  PRISMA_RETRYABLE_ERROR_CODES,
  withPrismaRetry,
} from "./client";

/**
 * Builds a `PrismaClientKnownRequestError`-shaped error (a plain object
 * carrying a `code`) — the shape Prisma raises while executing a query.
 *
 * why: constructing the real `PrismaClientKnownRequestError` requires
 * private constructor args tied to an engine version; a plain object with
 * `.code` is exactly what the structural check reads, so it exercises the same
 * code path without an engine dependency.
 */
function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`mock prisma error ${code}`), { code });
}

/**
 * Builds a `PrismaClientInitializationError`-shaped error (a plain object
 * carrying an `errorCode`) — the shape Prisma raises when the lazy client
 * fails to establish its FIRST connection during a DB outage. Crucially the
 * transient code lands on `errorCode`, NOT `code`.
 *
 * why: same as {@link prismaError} — the real error's constructor is
 * engine-coupled, and the structural check only reads `errorCode`, so a plain
 * object reproduces the startup/reconnection path faithfully.
 */
function prismaInitError(errorCode: string): Error & { errorCode: string } {
  return Object.assign(new Error(`mock prisma init error ${errorCode}`), {
    errorCode,
  });
}

/**
 * Type-safe check for "did this rejection carry the given Prisma error
 * code", used as the matcher argument to `assert.rejects`. Avoids narrowing
 * through `instanceof Error` (which doesn't know about `.code`) and avoids
 * `any` — mirrors the structural check the client itself uses.
 */
function rejectedWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * Builds the Postgres shared-lock-table-exhaustion error (SQLSTATE 53200) as
 * Prisma surfaces it: a `P2010` (raw query failed) carrying the SQLSTATE on
 * `meta.code`, with the hint embedded in the message. Mirrors SHELF-WEBAPP-227.
 *
 * why: same as {@link prismaError} — the real `PrismaClientKnownRequestError`
 * constructor is engine-coupled; a plain object with the fields the structural
 * checks read reproduces the path faithfully.
 */
function lockExhaustionError(): Error & {
  code: string;
  meta: { code: string };
} {
  return Object.assign(
    new Error(
      "\nInvalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `53200`. Message: `ERROR: out of shared memory\nHINT: You might need to increase max_locks_per_transaction.`"
    ),
    { code: "P2010", meta: { code: "53200" } }
  );
}

test("getRetryableErrorCode", async (t) => {
  await t.test("reads `code` from a known-request error shape", () => {
    assert.equal(getRetryableErrorCode(prismaError("P1001")), "P1001");
  });

  await t.test("reads `errorCode` from an initialization error shape", () => {
    // Regression: a DB outage at cold start surfaces the code on `errorCode`,
    // not `code`; a predicate reading only `code` would never retry it.
    assert.equal(getRetryableErrorCode(prismaInitError("P1002")), "P1002");
  });

  await t.test("returns null for P2024 and non-transient codes", () => {
    assert.equal(getRetryableErrorCode(prismaError("P2024")), null);
    assert.equal(getRetryableErrorCode(prismaError("P2002")), null);
    assert.equal(getRetryableErrorCode(prismaInitError("P1003")), null);
  });

  await t.test("returns null for non-Prisma / non-object values", () => {
    assert.equal(getRetryableErrorCode(new Error("boom")), null);
    assert.equal(getRetryableErrorCode("just a string"), null);
    assert.equal(getRetryableErrorCode(null), null);
    assert.equal(getRetryableErrorCode(undefined), null);
  });
});

test("isLockTableExhaustionError", async (t) => {
  await t.test("detects the SQLSTATE 53200 on `meta.code`", () => {
    assert.equal(isLockTableExhaustionError(lockExhaustionError()), true);
  });

  await t.test("detects the hint text in the message as a fallback", () => {
    const error = new Error(
      "Raw query failed: ERROR: out of shared memory HINT: increase max_locks_per_transaction."
    );
    assert.equal(isLockTableExhaustionError(error), true);
  });

  await t.test(
    "does NOT match a generic P2010 raw-query failure (different SQLSTATE)",
    () => {
      // A genuinely broken raw query is also a P2010 — matching on the bare
      // code would swallow real bugs. Only the 53200 signature must match.
      const error = Object.assign(
        new Error(
          'Raw query failed. Code: `42703`. column "foo" does not exist'
        ),
        { code: "P2010", meta: { code: "42703" } }
      );
      assert.equal(isLockTableExhaustionError(error), false);
    }
  );

  await t.test("returns false for unrelated / non-object values", () => {
    assert.equal(isLockTableExhaustionError(new Error("boom")), false);
    assert.equal(isLockTableExhaustionError(prismaError("P1001")), false);
    assert.equal(isLockTableExhaustionError(null), false);
    assert.equal(isLockTableExhaustionError(undefined), false);
  });
});

test("isRetryablePrismaError", async (t) => {
  await t.test(
    "connection-level codes (P1001/P1002) retry for reads AND writes",
    () => {
      for (const code of ["P1001", "P1002"]) {
        assert.equal(
          isRetryablePrismaError(prismaError(code), { operationIsRead: true }),
          true
        );
        assert.equal(
          isRetryablePrismaError(prismaError(code), { operationIsRead: false }),
          true
        );
      }
    }
  );

  await t.test(
    "in-flight codes (P1008/P1017) retry for reads but NOT writes",
    () => {
      for (const code of ["P1008", "P1017"]) {
        assert.equal(
          isRetryablePrismaError(prismaError(code), { operationIsRead: true }),
          true
        );
        assert.equal(
          isRetryablePrismaError(prismaError(code), { operationIsRead: false }),
          false,
          `${code} must not be retried on a write (may already have applied)`
        );
      }
    }
  );

  await t.test(
    "initialization errors retry via `errorCode` (write-safe connect codes)",
    () => {
      assert.equal(
        isRetryablePrismaError(prismaInitError("P1001"), {
          operationIsRead: false,
        }),
        true
      );
    }
  );

  await t.test(
    "lock-table exhaustion (53200) retries for reads but NOT writes",
    () => {
      // The statement failed acquiring locks before mutating anything, so a
      // read is safe to re-run; a write path is left to fail fast (gated like
      // the in-flight codes).
      assert.equal(
        isRetryablePrismaError(lockExhaustionError(), {
          operationIsRead: true,
        }),
        true
      );
      assert.equal(
        isRetryablePrismaError(lockExhaustionError(), {
          operationIsRead: false,
        }),
        false
      );
    }
  );

  await t.test("returns false for P2024 (pool exhaustion)", () => {
    assert.equal(
      isRetryablePrismaError(prismaError("P2024"), { operationIsRead: true }),
      false
    );
  });

  await t.test("returns false for a non-Prisma error (no code)", () => {
    assert.equal(
      isRetryablePrismaError(new Error("boom"), { operationIsRead: true }),
      false
    );
  });

  await t.test("returns false for non-object thrown values", () => {
    assert.equal(
      isRetryablePrismaError("just a string", { operationIsRead: true }),
      false
    );
    assert.equal(
      isRetryablePrismaError(null, { operationIsRead: true }),
      false
    );
    assert.equal(
      isRetryablePrismaError(undefined, { operationIsRead: true }),
      false
    );
  });

  await t.test("PRISMA_RETRYABLE_ERROR_CODES excludes P2024", () => {
    assert.equal(PRISMA_RETRYABLE_ERROR_CODES.has("P2024"), false);
    // The union of both severity buckets, for documentation/consumers.
    for (const code of ["P1001", "P1002", "P1008", "P1017"]) {
      assert.equal(PRISMA_RETRYABLE_ERROR_CODES.has(code), true);
    }
  });
});

test("withPrismaRetry", async (t) => {
  await t.test(
    "retries an in-flight P1017 error on a READ and returns the eventual success",
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
          operationIsRead: true,
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
    "retries a 53200 lock-exhaustion error on a READ and logs the SQLSTATE",
    async () => {
      // SHELF-WEBAPP-227: the raw /assets query trips 53200 under load; a
      // moment later the shared lock table has headroom again, so the retry
      // succeeds and the user never sees the overload.
      let calls = 0;
      const delays: number[] = [];
      const logs: string[] = [];

      const result = await withPrismaRetry(
        async () => {
          calls += 1;
          if (calls === 1) throw lockExhaustionError();
          return "ok";
        },
        {
          operationIsRead: true,
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
      // The lock error rides on a P2010, so the log falls back to the SQLSTATE.
      assert.match(logs[0], /53200/);
    }
  );

  await t.test(
    "does NOT retry a 53200 lock-exhaustion error on a WRITE",
    async () => {
      let calls = 0;

      await assert.rejects(
        () =>
          withPrismaRetry(
            async () => {
              calls += 1;
              throw lockExhaustionError();
            },
            { operationIsRead: false, log: () => {} }
          ),
        (error: unknown) => rejectedWithCode(error, "P2010")
      );

      assert.equal(calls, 1, "lock exhaustion on a write must fail fast");
    }
  );

  await t.test(
    "does NOT retry an in-flight P1017 error on a WRITE — throws immediately",
    async () => {
      // The mutation may already have committed before the connection dropped;
      // retrying could duplicate a row. Writes only retry connection-level codes.
      let calls = 0;
      const logs: string[] = [];

      await assert.rejects(
        () =>
          withPrismaRetry(
            async () => {
              calls += 1;
              throw prismaError("P1017");
            },
            { operationIsRead: false, log: (message) => logs.push(message) }
          ),
        (error: unknown) => rejectedWithCode(error, "P1017")
      );

      assert.equal(calls, 1, "in-flight code on a write must fail fast");
      assert.equal(logs.length, 0, "no retry log line for a non-retried write");
    }
  );

  await t.test(
    "retries a connection-level P1001 error on a WRITE (query never reached the DB)",
    async () => {
      let calls = 0;
      const delays: number[] = [];

      const result = await withPrismaRetry(
        async () => {
          calls += 1;
          if (calls === 1) throw prismaError("P1001");
          return "ok";
        },
        {
          operationIsRead: false,
          delay: async (ms) => {
            delays.push(ms);
          },
          log: () => {},
        }
      );

      assert.equal(result, "ok");
      assert.equal(calls, 2);
      assert.deepEqual(delays, [500]);
    }
  );

  await t.test(
    "retries an initialization error (code on `errorCode`) on a WRITE",
    async () => {
      // Regression for the cold-start/reconnection outage: the transient code
      // lands on `errorCode`; a `.code`-only predicate would never retry it.
      let calls = 0;

      const result = await withPrismaRetry(
        async () => {
          calls += 1;
          if (calls === 1) throw prismaInitError("P1001");
          return "ok";
        },
        { operationIsRead: false, delay: async () => {}, log: () => {} }
      );

      assert.equal(result, "ok");
      assert.equal(calls, 2);
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

test("createDatabaseClient wires the transient-retry extension onto the client", () => {
  // The retry LOGIC is covered exhaustively above; this guards the WIRING — the
  // exact regression that already happened once, when the monorepo migration
  // silently dropped the retry `$extends` from this factory.
  //
  // A behavioral guard would have to intercept the applied extension chain, but
  // Prisma's client is a Proxy (its `$extends` isn't reachable on the prototype)
  // and injecting a fake base client perturbs Prisma's inferred client type
  // enough to break downstream typechecks. So this asserts the wiring at the
  // source level — the same cheap regression guard the repo uses elsewhere for
  // seams that can't be mocked (see the raw-SQL `@map` column-name rule).
  const source = readFileSync(
    fileURLToPath(new URL("./client.ts", import.meta.url)),
    "utf8"
  );

  const factoryStart = source.indexOf("export function createDatabaseClient");
  assert.notEqual(factoryStart, -1, "createDatabaseClient factory not found");

  // Bound the slice to the factory body — stop at the next top-level `export`
  // (or EOF) so a `$extends` / `withPrismaRetry` reference elsewhere in the file
  // can't satisfy these assertions after the factory wiring is removed. Collapse
  // whitespace so the assertions survive prettier reformatting.
  const afterFactory = source.indexOf("\nexport ", factoryStart + 1);
  const factory = source
    .slice(factoryStart, afterFactory === -1 ? undefined : afterFactory)
    .replace(/\s+/g, " ");

  assert.match(
    factory,
    /\$extends\(\{ query: \{ \$allModels: \{/,
    "the retry query `$extends` appears to have been removed from createDatabaseClient"
  );
  assert.match(
    factory,
    /withPrismaRetry\(\(\) => query\(args\)/,
    "createDatabaseClient no longer routes operations through withPrismaRetry"
  );
});
