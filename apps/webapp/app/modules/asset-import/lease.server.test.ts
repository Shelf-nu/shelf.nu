// @vitest-environment node
/**
 * Tests for the import lease: which imports a claim can match, the claim
 * result, that a lease always ends before its job expires, and that releasing
 * never throws.
 *
 * @see {@link file://./lease.server.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ASSET_IMPORT_JOB_OPTIONS } from "./constants";
import { claimImportLease, releaseImportLease } from "./lease.server";

// why: the lease lives on the import row in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { updateMany: vi.fn() } },
}));

// why: the logger writes to the console and Sentry.
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), error: vi.fn() },
}));

const args = { importId: "imp", organizationId: "org" };

describe("claimImportLease", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("only matches a QUEUED or RUNNING import whose lease is free or expired", async () => {
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    await claimImportLease(args);

    const call = vi.mocked(db.assetImport.updateMany).mock.calls[0][0];
    expect(call?.where).toEqual({
      id: "imp",
      organizationId: "org",
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: expect.any(Date) } }],
    });
    // The new lease ends in the future.
    const lockedUntil = (call?.data as { lockedUntil: Date }).lockedUntil;
    expect(lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("succeeds when the lease was free or expired", async () => {
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    await expect(claimImportLease(args)).resolves.toBe(true);
  });

  it("fails while another run holds an unexpired lease, or the import is not active", async () => {
    // The status and lease filters exclude the row, so nothing matches.
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 0 });

    await expect(claimImportLease(args)).resolves.toBe(false);
  });
});

describe("lease length", () => {
  const jobExpiryMs = ASSET_IMPORT_JOB_OPTIONS.expireInMinutes * 60 * 1000;
  const claimedAt = new Date("2026-10-15T10:00:00.000Z");

  beforeEach(() => {
    vi.resetAllMocks();
    // why: the lease end is computed from the current time.
    vi.useFakeTimers();
    vi.setSystemTime(claimedAt);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends a claim made at T before T plus the job expiry", async () => {
    await claimImportLease(args);

    const data = vi.mocked(db.assetImport.updateMany).mock.calls[0][0]
      ?.data as { lockedUntil: Date };
    expect(data.lockedUntil.getTime()).toBeLessThan(
      claimedAt.getTime() + jobExpiryMs
    );
  });

  it("lets a retry that arrives after the job expiry claim the lapsed lease", async () => {
    await claimImportLease(args);
    const firstLease = (
      vi.mocked(db.assetImport.updateMany).mock.calls[0][0]?.data as {
        lockedUntil: Date;
      }
    ).lockedUntil;

    // The process died; pg-boss retries the job once it has expired.
    vi.setSystemTime(new Date(claimedAt.getTime() + jobExpiryMs));
    await claimImportLease(args);

    // The retry only matches a lease that ended before its own "now", and the
    // first lease did end before then, so the database update matches the row.
    const retryWhere = vi.mocked(db.assetImport.updateMany).mock.calls[1][0]
      ?.where as unknown as { OR: [unknown, { lockedUntil: { lt: Date } }] };
    expect(retryWhere.OR[1].lockedUntil.lt.getTime()).toBeGreaterThan(
      firstLease.getTime()
    );
  });
});

describe("releaseImportLease", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("clears the lease", async () => {
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    await releaseImportLease(args);

    expect(db.assetImport.updateMany).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org" },
      data: { lockedUntil: null },
    });
  });

  it("never throws", async () => {
    vi.mocked(db.assetImport.updateMany).mockRejectedValue(
      new Error("connection lost")
    );

    await expect(releaseImportLease(args)).resolves.toBeUndefined();
  });
});
