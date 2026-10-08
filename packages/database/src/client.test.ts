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
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  createDatabaseClient,
  getRetryableErrorCode,
  isReadOperation,
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
  await t.test(
    "detects lock-table exhaustion via the max_locks_per_transaction hint",
    () => {
      assert.equal(isLockTableExhaustionError(lockExhaustionError()), true);
    }
  );

  await t.test("detects the hint when it rides only on `meta.message`", () => {
    const error = Object.assign(new Error("Raw query failed. Code: `53200`."), {
      code: "P2010",
      meta: {
        code: "53200",
        message:
          "ERROR: out of shared memory\nHINT: You might need to increase max_locks_per_transaction.",
      },
    });
    assert.equal(isLockTableExhaustionError(error), true);
  });

  await t.test(
    "does NOT match a generic 53200 out_of_memory WITHOUT the lock hint",
    () => {
      // 53200 is Postgres out_of_memory generally — backend OOM raises it too.
      // Retrying a real memory-exhaustion read would deepen the incident, so a
      // 53200 without the max_locks_per_transaction hint must not match.
      const error = Object.assign(
        new Error(
          "Raw query failed. Code: `53200`. Message: `ERROR: out of memory`"
        ),
        {
          code: "P2010",
          meta: { code: "53200", message: "ERROR: out of memory" },
        }
      );
      assert.equal(isLockTableExhaustionError(error), false);
    }
  );

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

  await t.test(
    "does NOT retry a generic 53200 out_of_memory (no lock hint) on a read",
    () => {
      // Guards the narrowing: a real backend OOM (53200 without the hint) must
      // fail fast, not get retried into a deeper memory incident.
      const oom = Object.assign(
        new Error(
          "Raw query failed. Code: `53200`. Message: `ERROR: out of memory`"
        ),
        {
          code: "P2010",
          meta: { code: "53200", message: "ERROR: out of memory" },
        }
      );
      assert.equal(
        isRetryablePrismaError(oom, { operationIsRead: true }),
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

/**
 * A syntactically valid connection string that is never dialled: every test
 * below short-circuits the engine (see {@link clientWithProbe}), so no socket
 * is ever opened. A test that DOES reach the engine fails with a connection
 * error, which is the loud signal that the short-circuit stopped working.
 */
const UNREACHABLE_URL = "postgresql://user:pass@127.0.0.1:1/never-dialled";

/**
 * Builds a real client from {@link createDatabaseClient} with a probe chained
 * onto it, standing in for the database.
 *
 * Query-extension callbacks run in registration order, so the factory's retry
 * extension runs first and its `query(args)` resolves into the probe rather
 * than the engine. That makes the factory's own wiring observable — the probe
 * counts how many times each operation actually reached "the database", which
 * is exactly what a retry changes.
 *
 * @param respond - Called per attempt with the 1-based attempt number for that
 *   operation. Return a value to resolve the query; throw to fail it.
 * @returns The client, plus the operations recorded in the order they arrived.
 */
function clientWithProbe(respond: (attempt: number) => unknown) {
  const attempts: string[] = [];
  const seenArgs: unknown[] = [];
  const client = createDatabaseClient(UNREACHABLE_URL).$extends({
    query: {
      async $allOperations({ operation, args }) {
        attempts.push(operation);
        seenArgs.push(args);
        return respond(attempts.length) as never;
      },
    },
  });
  return { client, attempts, seenArgs };
}

/**
 * Exercises the client the factory actually builds, rather than asserting on
 * the shape of its source. Retrying is observable as a repeated attempt, so
 * the probe's attempt count is a direct read of whether an operation is
 * covered — which no source-level pattern match can tell you.
 *
 * A case that provokes an extension retry sleeps for real, since the backoff
 * belongs to the extension and no test can reach past it — 500ms before the
 * first retry. Cases that drive the backoff themselves pass a no-op `delay`.
 */
test("createDatabaseClient retries raw SQL, not just model operations", async (t) => {
  await t.test("retries $queryRaw on a connection-level error", async () => {
    // Raw SQL carries the SSO user-id migration, sequential-ID generation and
    // the dashboard aggregates. A connection blip on any of them surfaced to
    // the user as a 503 while every model query beside it was quietly retried.
    const { client, attempts } = clientWithProbe((attempt) => {
      if (attempt === 1) throw prismaError("P1001");
      return [{ ok: true }];
    });

    const rows = await client.$queryRaw`SELECT 1`;

    assert.deepEqual(rows, [{ ok: true }]);
    assert.deepEqual(attempts, ["$queryRaw", "$queryRaw"]);
  });

  await t.test("retries all four raw entry points", async () => {
    // `$executeRaw` and the two `Unsafe` variants are separate Prisma
    // operations with their own dispatch, so covering one proves nothing
    // about the others.
    for (const run of [
      (c: ReturnType<typeof clientWithProbe>["client"]) =>
        c.$executeRaw`SELECT 1`,
      (c: ReturnType<typeof clientWithProbe>["client"]) =>
        c.$queryRawUnsafe("SELECT 1"),
      (c: ReturnType<typeof clientWithProbe>["client"]) =>
        c.$executeRawUnsafe("SELECT 1"),
    ]) {
      const { client, attempts } = clientWithProbe((attempt) => {
        if (attempt === 1) throw prismaError("P1002");
        return 1;
      });

      await run(client);

      assert.equal(attempts.length, 2, `${attempts[0]} was not retried`);
    }
  });

  await t.test("still retries model reads on an in-flight error", async () => {
    // The switch that brings raw SQL in must not cost model operations their
    // existing classification.
    const { client, attempts } = clientWithProbe((attempt) => {
      if (attempt === 1) throw prismaError("P1017");
      return [];
    });

    await client.user.findMany({});

    assert.deepEqual(attempts, ["findMany", "findMany"]);
  });

  await t.test("does NOT retry raw SQL on an in-flight error", async () => {
    // `P1017` can surface after the statement reached the server, so the
    // statement may already have run. Raw SQL is opaque to this layer — a
    // `$queryRaw` in this repo consumes a Postgres sequence, and several take
    // `FOR UPDATE` locks — so it is classified as a write and left alone.
    const { client, attempts } = clientWithProbe(() => {
      throw prismaError("P1017");
    });

    await assert.rejects(
      client.$queryRaw`SELECT get_next_sequential_id('org', 'SAM')`,
      (error: unknown) => rejectedWithCode(error, "P1017")
    );
    assert.deepEqual(attempts, ["$queryRaw"]);
  });

  await t.test("does not stack its retries on a caller's own", async () => {
    // Two raw queries in the app wrap themselves in `withPrismaRetry` to claim
    // read semantics the extension cannot infer. If both layers retried, the
    // attempts would multiply and a failing request would hold on ~4x longer
    // during the outage that provoked it.
    const { client, attempts } = clientWithProbe(() => {
      throw prismaError("P1001");
    });

    await assert.rejects(
      withPrismaRetry(() => client.$queryRaw`SELECT 1`, {
        operationIsRead: true,
        // why: the caller's own backoff is not what this asserts, and skipping
        // it keeps the case instant. An extension retry that wrongly stacked
        // would still be counted — it just would not be slow about it.
        delay: async () => {},
      }),
      (error: unknown) => rejectedWithCode(error, "P1001")
    );

    // Three: the caller's own attempt plus its two retries, and no more.
    assert.equal(attempts.length, 3);
  });

  await t.test("honours a caller's read claim on a raw query", async () => {
    // The extension classifies raw SQL as a write, so it would not retry an
    // in-flight failure. A caller that has read its own statement can, and
    // that judgement has to survive passing through the extension — it is why
    // the advanced asset index recovers from lock-table exhaustion.
    const { client, attempts } = clientWithProbe((attempt) => {
      if (attempt === 1) throw prismaError("P1017");
      return [];
    });

    await withPrismaRetry(() => client.$queryRaw`SELECT 1`, {
      operationIsRead: true,
      // why: as above — the backoff itself is covered by the withPrismaRetry
      // tests, so this case skips it and stays instant.
      delay: async () => {},
    });

    assert.deepEqual(attempts, ["$queryRaw", "$queryRaw"]);
  });

  await t.test("hands raw parameters to the engine unchanged", async () => {
    // Intercepting an operation makes Prisma clone its arguments before the
    // callback sees them — a step the raw path skipped entirely while it had
    // no callback. The cloner reconstructs `Sql` and rebuilds each parameter
    // by type, so a type it mishandled would corrupt every raw query in the
    // codebase without raising anything.
    const { client, seenArgs } = clientWithProbe(() => []);

    const id = "org-1";
    const when = new Date("2026-08-25T10:00:00.000Z");
    const bytes = Buffer.from([1, 2, 3]);
    const amount = new Prisma.Decimal("12.34");

    await client.$queryRaw`SELECT ${id}, ${when}, ${1n}, ${bytes}, ${amount}, ${null}`;

    const tagged = seenArgs[0] as Prisma.Sql;
    assert.equal(tagged.text, "SELECT $1, $2, $3, $4, $5, $6");
    const [gotId, gotDate, gotBigInt, gotBytes, gotAmount, gotNull] =
      tagged.values as unknown[];
    assert.equal(gotId, id);
    assert.ok(gotDate instanceof Date, "a Date parameter must stay a Date");
    assert.equal((gotDate as Date).getTime(), when.getTime());
    assert.equal(gotBigInt, 1n);
    assert.ok(ArrayBuffer.isView(gotBytes), "bytes must stay a typed array");
    assert.deepEqual([...(gotBytes as Uint8Array)], [1, 2, 3]);
    assert.equal(String(gotAmount), "12.34");
    assert.equal(gotNull, null);

    // `$queryRawUnsafe`/`$executeRawUnsafe` arrive as `[sql, ...params]`
    // instead of a `Sql`, and take a different branch of the same cloner.
    await client.$queryRawUnsafe("SELECT $1::text, $2::int", id, 7);
    assert.deepEqual(seenArgs[1], ["SELECT $1::text, $2::int", id, 7]);
  });

  await t.test(
    "does NOT retry a model write on an in-flight error",
    async () => {
      const { client, attempts } = clientWithProbe(() => {
        throw prismaError("P1017");
      });

      await assert.rejects(
        client.user.update({ where: { id: "u1" }, data: {} }),
        (error: unknown) => rejectedWithCode(error, "P1017")
      );
      assert.deepEqual(attempts, ["update"]);
    }
  );
});

test("isReadOperation", async (t) => {
  await t.test("classifies the model read operations as reads", () => {
    for (const operation of [
      "findUnique",
      "findUniqueOrThrow",
      "findFirst",
      "findFirstOrThrow",
      "findMany",
      "count",
      "aggregate",
      "groupBy",
    ]) {
      assert.equal(
        isReadOperation({ model: "Asset", operation }),
        true,
        `${operation} should classify as a read`
      );
    }
  });

  await t.test("classifies model mutations as writes", () => {
    for (const operation of [
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
    ]) {
      assert.equal(isReadOperation({ model: "Asset", operation }), false);
    }
  });

  await t.test("classifies every raw operation as a write", () => {
    // A raw `SELECT` is not a promise of purity, and this layer cannot read
    // the SQL to find out: `SELECT get_next_sequential_id(...)` consumes a
    // Postgres sequence, and `SELECT ... FOR UPDATE` takes locks. Calling
    // either one a read would let an in-flight failure re-run it.
    for (const operation of [
      "$queryRaw",
      "$queryRawUnsafe",
      "$executeRaw",
      "$executeRawUnsafe",
    ]) {
      assert.equal(
        isReadOperation({ model: undefined, operation }),
        false,
        `${operation} must not be treated as a read`
      );
    }
  });

  await t.test("keys off the missing model, not the operation name", () => {
    // Prisma passes no model for a raw query, which is the only signal that
    // separates the two. An operation name that happens to look like a read
    // does not make an unmodelled operation retryable.
    assert.equal(
      isReadOperation({ model: undefined, operation: "findMany" }),
      false
    );
  });
});
