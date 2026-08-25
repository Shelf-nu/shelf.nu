// @vitest-environment node
/**
 * Behaviour tests for {@link removeAuditScan} — the shared undo both the web
 * scan page and the mobile remove-scan endpoint delegate to.
 *
 * The contract under test: an EXPECTED asset's row survives the removal and
 * returns to MISSING with its scan facts cleared; an UNEXPECTED asset's row is
 * deleted outright (only the scan created it); and the session's aggregate
 * counts are recomputed from the rows, never incremented, so they cannot
 * drift from what the rows say.
 *
 * @see {@link file://./service.server.ts} — `removeAuditScan`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { removeAuditScan } from "~/modules/audit/service.server";

// why: the subject is the branch logic and the recompute; the database is the
// boundary being asserted against, so it is the one thing mocked. $transaction
// hands back the same mock so `tx.*` assertions read naturally.
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi
      .fn()
      .mockImplementation((cb: (tx: unknown) => unknown) => cb(db)),
    auditSession: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    auditScan: {
      findFirst: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    auditAsset: {
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      count: vi.fn(),
    },
  },
}));

// why: the note builder reaches into user/asset tables that are not part of
// this contract; the assertion is only that a removal note is written inside
// the same transaction.
vi.mock("~/modules/audit/helpers.server", async () => {
  const actual = await vi.importActual<object>(
    "~/modules/audit/helpers.server"
  );
  return { ...actual, createAssetScanRemovedNote: vi.fn() };
});

const session = {
  status: "ACTIVE",
  foundAssetCount: 3,
  missingAssetCount: 1,
  unexpectedAssetCount: 1,
};

const ARGS = {
  auditSessionId: "audit-1",
  assetId: "asset-1",
  userId: "user-1",
  organizationId: "org-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.auditSession.findFirst).mockResolvedValue(session as never);
  // Recomputed counts after the removal: found, missing, unexpected.
  vi.mocked(db.auditAsset.count)
    .mockResolvedValueOnce(2 as never)
    .mockResolvedValueOnce(2 as never)
    .mockResolvedValueOnce(1 as never);
});

describe("removeAuditScan", () => {
  it("returns an expected asset to MISSING and keeps its row", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-1",
      auditAsset: { id: "aa-1", expected: true },
    } as never);

    const result = await removeAuditScan(ARGS);

    expect(db.auditAsset.update).toHaveBeenCalledWith({
      where: { id: "aa-1" },
      data: { status: "MISSING", scannedAt: null, scannedById: null },
    });
    expect(db.auditAsset.delete).not.toHaveBeenCalled();
    expect(db.auditScan.delete).toHaveBeenCalledWith({
      where: { id: "scan-1" },
    });
    expect(result).toEqual({
      removed: true,
      foundAssetCount: 2,
      missingAssetCount: 2,
      unexpectedAssetCount: 1,
    });
  });

  it("deletes an unexpected asset's row along with the scan", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-2",
      auditAsset: { id: "aa-2", expected: false },
    } as never);

    await removeAuditScan(ARGS);

    expect(db.auditAsset.delete).toHaveBeenCalledWith({
      where: { id: "aa-2" },
    });
    expect(db.auditAsset.update).not.toHaveBeenCalled();
  });

  it("writes the recomputed counts to the session, never increments", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-1",
      auditAsset: { id: "aa-1", expected: true },
    } as never);

    await removeAuditScan(ARGS);

    expect(db.auditSession.update).toHaveBeenCalledWith({
      where: { id: "audit-1" },
      data: {
        foundAssetCount: 2,
        missingAssetCount: 2,
        unexpectedAssetCount: 1,
      },
    });
  });

  it("reports removed: false when no scan exists, touching nothing", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue(null as never);

    const result = await removeAuditScan(ARGS);

    expect(result.removed).toBe(false);
    expect(db.auditScan.delete).not.toHaveBeenCalled();
    expect(db.auditSession.update).not.toHaveBeenCalled();
  });

  it("404s for a session outside the caller's organization", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(null as never);

    await expect(removeAuditScan(ARGS)).rejects.toThrow(/not found/i);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
