// @vitest-environment node
/**
 * Behaviour tests for {@link removeAuditScan} — the shared undo both the web
 * scan page and the mobile remove-scan endpoint delegate to.
 *
 * The contract under test: an EXPECTED asset's row survives the removal and
 * returns to MISSING with its scan facts cleared; an UNEXPECTED asset's row is
 * deleted outright (only the scan created it); the session's aggregate counts
 * are recomputed from the rows, never incremented, so they cannot drift from
 * what the rows say; and an `AUDIT_ASSET_SCAN_REMOVED` activity event is
 * emitted in the same transaction, so the stream that recorded the scan going
 * in also records it coming out.
 *
 * @see {@link file://./service.server.ts} — `removeAuditScan`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
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
// this contract, and loading the real helpers module pulls a dependency graph
// this suite does not need. Only the export removeAuditScan touches is stubbed;
// nothing else from the module runs here.
vi.mock("~/modules/audit/helpers.server", () => ({
  createAssetScanRemovedNote: vi.fn(),
}));

// why: `recordEvent` writes through the transaction client, which is the same
// mock as `db` here — the real implementation would reach for delegates this
// suite does not stub. The argument it is called with IS the assertion, so it
// is captured rather than executed.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
  recordEvents: vi.fn(),
}));

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
  // `clearAllMocks` clears call history but does NOT drain a
  // `mockResolvedValueOnce` queue, so a case that never reaches the recompute
  // (no scan, dead audit, cross-org) leaves its three queued counts at the
  // head for the NEXT test to consume. Reset this one mock so each case reads
  // the values it queued rather than a predecessor's.
  vi.mocked(db.auditAsset.count).mockReset();
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

  it("emits AUDIT_ASSET_SCAN_REMOVED so the scan's removal reaches reports", async () => {
    // The counterpart to recordAuditScan's AUDIT_ASSET_SCANNED. Without it a
    // report counting scans on a corrected audit overstates it — the scan goes
    // into the stream and never comes out.
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-1",
      auditAsset: { id: "aa-1", expected: true },
    } as never);

    await removeAuditScan(ARGS);

    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordEvent).mock.calls[0][0]).toEqual({
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "AUDIT_ASSET_SCAN_REMOVED",
      entityType: "AUDIT",
      entityId: "audit-1",
      auditSessionId: "audit-1",
      auditAssetId: "aa-1",
      assetId: "asset-1",
      meta: { isExpected: true },
    });
  });

  it("carries the deleted row's id on the unexpected branch, so the pair stays joinable", async () => {
    // The AuditAsset row is deleted here, but `auditAssetId` on ActivityEvent
    // is a plain scalar with no FK — keeping it is what lets a reader match
    // this event to the AUDIT_ASSET_SCANNED that created the row.
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-2",
      auditAsset: { id: "aa-2", expected: false },
    } as never);

    await removeAuditScan(ARGS);

    expect(vi.mocked(recordEvent).mock.calls[0][0]).toMatchObject({
      auditAssetId: "aa-2",
      meta: { isExpected: false },
    });
  });

  it("writes the event through the same transaction as the mutation", async () => {
    // An event committed outside the transaction can outlive a rollback and
    // report a removal that never happened.
    vi.mocked(db.auditScan.findFirst).mockResolvedValue({
      id: "scan-1",
      auditAsset: { id: "aa-1", expected: true },
    } as never);

    await removeAuditScan(ARGS);

    expect(vi.mocked(recordEvent).mock.calls[0][1]).toBe(db);
  });

  it("emits no event when there was no scan to remove", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue(null as never);

    await removeAuditScan(ARGS);

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("reports removed: false when no scan exists, touching nothing", async () => {
    vi.mocked(db.auditScan.findFirst).mockResolvedValue(null as never);

    const result = await removeAuditScan(ARGS);

    expect(result.removed).toBe(false);
    expect(db.auditScan.delete).not.toHaveBeenCalled();
    expect(db.auditSession.update).not.toHaveBeenCalled();
  });

  it("refuses removal from an audit that is no longer live", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue({
      ...session,
      status: "COMPLETED",
    } as never);

    await expect(removeAuditScan(ARGS)).rejects.toThrow(/no longer live/i);
    // The status is re-read INSIDE the transaction (an audit can complete
    // between a check outside it and the write), so the assertion is that
    // nothing was mutated — a stronger claim than "no transaction opened".
    expect(db.auditScan.delete).not.toHaveBeenCalled();
    expect(db.auditAsset.update).not.toHaveBeenCalled();
    expect(db.auditAsset.delete).not.toHaveBeenCalled();
    expect(db.auditSession.update).not.toHaveBeenCalled();
  });

  it("404s for a session outside the caller's organization", async () => {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue(null as never);

    await expect(removeAuditScan(ARGS)).rejects.toThrow(/not found/i);
    expect(db.auditScan.findFirst).not.toHaveBeenCalled();
    expect(db.auditSession.update).not.toHaveBeenCalled();
  });
});
