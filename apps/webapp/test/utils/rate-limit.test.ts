import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceUserRateLimit,
  __resetUserRateLimitForTests,
} from "~/utils/rate-limit.server";

// @vitest-environment node

describe("enforceUserRateLimit", () => {
  beforeEach(() => {
    __resetUserRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to 10 bulk calls per minute then blocks", async () => {
    const userId = "user-1";

    for (let i = 0; i < 10; i++) {
      await expect(
        enforceUserRateLimit(userId, "bulk")
      ).resolves.toBeUndefined();
    }

    await expect(enforceUserRateLimit(userId, "bulk")).rejects.toMatchObject({
      status: 429,
    });
  });

  it("resets the minute window after 60s", async () => {
    const userId = "user-2";

    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit(userId, "bulk");
    }
    await expect(enforceUserRateLimit(userId, "bulk")).rejects.toMatchObject({
      status: 429,
    });

    vi.advanceTimersByTime(60_000 + 1);

    await expect(enforceUserRateLimit(userId, "bulk")).resolves.toBeUndefined();
  });

  it("enforces the hourly bulk cap independently of the minute cap", async () => {
    const userId = "user-3";

    // Burn 200 bulk calls across 20 minutes (10/min within the limit each min)
    for (let minute = 0; minute < 20; minute++) {
      vi.setSystemTime(
        new Date(`2026-05-01T00:${minute.toString().padStart(2, "0")}:00Z`)
      );
      for (let i = 0; i < 10; i++) {
        await enforceUserRateLimit(userId, "bulk");
      }
    }

    // 21st minute starts: minute window resets, hour window does not
    vi.setSystemTime(new Date("2026-05-01T00:20:00Z"));
    await expect(enforceUserRateLimit(userId, "bulk")).rejects.toMatchObject({
      status: 429,
    });
  });

  it("buckets are per-user", async () => {
    for (let i = 0; i < 10; i++) {
      await enforceUserRateLimit("user-A", "bulk");
    }
    await expect(enforceUserRateLimit("user-A", "bulk")).rejects.toMatchObject({
      status: 429,
    });

    // user-B is unaffected
    await expect(
      enforceUserRateLimit("user-B", "bulk")
    ).resolves.toBeUndefined();
  });

  it("read bucket is far more permissive than bulk", async () => {
    // 120 reads/min should pass; the 121st blocks
    for (let i = 0; i < 120; i++) {
      await enforceUserRateLimit("reader", "read");
    }
    await expect(enforceUserRateLimit("reader", "read")).rejects.toMatchObject({
      status: 429,
    });
  });
});
