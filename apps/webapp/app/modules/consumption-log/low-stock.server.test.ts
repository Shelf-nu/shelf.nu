/**
 * Behavior tests for the low-stock fan-out helper.
 *
 * `notifyLowStockForAssets` is the seam every stock-DECREASING path calls
 * (booking check-in CONSUME/LOSS/DAMAGE dispositions, asset-edit / CSV
 * quantity reductions). Its contract — dedupe to ONE check per asset per
 * request, isolate per-asset failures, never throw — is what the calling
 * services rely on when they fire-and-forget it post-commit, so it gets
 * direct coverage here rather than only wiring assertions in the callers'
 * suites.
 *
 * The unit under test is the FAN-OUT, not the alert pipeline: the tests
 * observe `checkAndNotifyLowStock`'s entry query (one org-scoped asset read
 * per check) and the failure logging, never the notification internals.
 *
 * @see {@link file://./low-stock.server.ts}
 */

import { beforeEach, describe, expect, it, vi, vitest } from "vitest";
import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { notifyLowStockForAssets } from "./low-stock.server";

// why: the fan-out delegates each asset to checkAndNotifyLowStock, whose
// first observable step is exactly one org-scoped `asset.findFirst` per
// check — mocking the db lets us count checks (and force one to fail)
// without touching the real alert pipeline. `null` = asset not found, so a
// check completes as a harmless no-op by default.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    organization: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: a rejected per-asset check must be LOGGED, not thrown — the helper's
// never-throws posture is part of the contract under test.
vitest.mock("~/utils/logger", () => ({
  Logger: { error: vitest.fn() },
}));

// why: mail.server pulls in the pg-boss scheduler and the notification
// emitter pulls in SSE state at import time — neither belongs in a unit
// test of the fan-out (and no test path reaches them: the mocked asset
// lookup returns null so no alert is ever composed).
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));
vitest.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vitest.fn(),
}));

const mockedAssetFindFirst = vi.mocked(db.asset.findFirst);

beforeEach(() => {
  vitest.clearAllMocks();
  // why: clearAllMocks keeps implementations; re-seed the "asset not found →
  // check no-ops" default each test builds on.
  mockedAssetFindFirst.mockResolvedValue(null as never);
});

describe("notifyLowStockForAssets", () => {
  it("runs exactly one check per UNIQUE asset id (duplicates collapse to a single potential alert)", async () => {
    await notifyLowStockForAssets({
      assetIds: ["asset-1", "asset-1", "asset-2", "asset-1"],
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockedAssetFindFirst).toHaveBeenCalledTimes(2);
    const checkedIds = mockedAssetFindFirst.mock.calls.map(
      (call) => (call[0]?.where as { id: string }).id
    );
    expect(checkedIds).toEqual(["asset-1", "asset-2"]);
  });

  it("isolates a failing asset: siblings still get checked and the helper resolves instead of rejecting", async () => {
    // why: force the FIRST asset's check to blow up mid-flight — the
    // Promise.allSettled contract must keep the second check alive.
    mockedAssetFindFirst
      .mockRejectedValueOnce(new Error("connection reset") as never)
      .mockResolvedValueOnce(null as never);

    await expect(
      notifyLowStockForAssets({
        assetIds: ["asset-boom", "asset-2"],
        userId: "user-1",
        organizationId: "org-1",
      })
    ).resolves.toBeUndefined();

    // The sibling check ran despite the failure…
    expect(mockedAssetFindFirst).toHaveBeenCalledTimes(2);
    // …and the failure was logged (not swallowed silently, not thrown).
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("performs no checks at all for an empty input", async () => {
    await notifyLowStockForAssets({
      assetIds: [],
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockedAssetFindFirst).not.toHaveBeenCalled();
    expect(Logger.error).not.toHaveBeenCalled();
  });
});
