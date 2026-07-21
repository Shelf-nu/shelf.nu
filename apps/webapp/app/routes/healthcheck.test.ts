/**
 * Tests for the Fly.io healthcheck loader's "busy ≠ dead" behavior.
 *
 * Covers the three outcomes of racing the DB probe against
 * `HEALTHCHECK_DB_TIMEOUT_MS`: a fast healthy probe, a fast genuine failure,
 * and a probe that is still pending when the internal timeout fires (the
 * pool-saturation case this route exists to protect against -- see the
 * file-level doc on `healthcheck.tsx`).
 *
 * @see {@link file://./healthcheck.tsx} loader under test
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

import { loader, HEALTHCHECK_DB_TIMEOUT_MS } from "./healthcheck";
import { assertIsDataWithResponseInit } from "../../test/helpers/assertions";

// why: isolate the loader from a real Prisma connection -- only
// `db.user.findFirst` is exercised by the route, so only it needs stubbing.
vi.mock("~/database/db.server", () => ({
  db: {
    user: { findFirst: vi.fn() },
  },
}));

// why: assert the "busy" branch logs a warning without letting pino/Sentry
// wiring run (and without polluting test output).
vi.mock("~/utils/logger", () => ({
  Logger: {
    warn: vi.fn(),
    error: vi.fn(),
    handledClientError: vi.fn(),
  },
}));

const findFirstMock = vi.mocked(db.user.findFirst);

describe("healthcheck loader", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns 200 when the DB probe resolves quickly", async () => {
    findFirstMock.mockResolvedValue({ id: "user-1" } as never);

    const result = await loader();

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(200);
    expect((result.data as { status: string }).status).toBe("OK");
  });

  it("returns 503 when the DB probe rejects quickly (genuine connection failure)", async () => {
    findFirstMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await loader();

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(503);
  });

  describe("when the DB probe is still pending after the internal timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("returns 200 (busy-but-alive) and never surfaces the late rejection as unhandled", async () => {
      // A deferred promise standing in for a probe blocked on a saturated
      // pool: it will not settle until we explicitly reject it below.
      let rejectProbe: (reason: unknown) => void = () => {};
      const pendingProbe = new Promise((_resolve, reject) => {
        rejectProbe = reject;
      });
      findFirstMock.mockReturnValue(pendingProbe as never);

      const resultPromise = loader();

      // Advance the fake clock past the internal budget so the race's
      // timeout side wins while the probe is still unsettled.
      await vi.advanceTimersByTimeAsync(HEALTHCHECK_DB_TIMEOUT_MS);

      const result = await resultPromise;
      assertIsDataWithResponseInit(result);
      expect(result.init?.status).toBe(200);
      expect((result.data as { degraded?: boolean }).degraded).toBe(true);

      // Track any unhandled rejection raised while the deferred probe
      // settles after the request has already responded -- the loader must
      // have attached its own `.catch` to prevent this.
      let unhandled: unknown;
      const onUnhandledRejection = (reason: unknown) => {
        unhandled = reason;
      };
      process.on("unhandledRejection", onUnhandledRejection);

      rejectProbe(new Error("connect ETIMEDOUT"));
      // Flush microtasks (using real timers here, since the rejection
      // handling itself doesn't depend on the fake clock) so the rejection
      // has a chance to propagate before we assert.
      await Promise.resolve();
      await Promise.resolve();

      process.off("unhandledRejection", onUnhandledRejection);
      expect(unhandled).toBeUndefined();
    });
  });
});
