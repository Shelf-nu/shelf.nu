/**
 * Audit-asset removal must not reach outside its own audit.
 *
 * `AuditAsset` carries no `organizationId`. It inherits its tenant purely
 * through `auditSession`, so `auditSessionId` is the ONLY thing that can scope
 * it — an id-only lookup matches every row in the table, in every workspace.
 *
 * The removal paths proved the AUDIT was org-owned and PENDING, then looked up
 * the audit asset by id alone, with the id taken straight from the request
 * body. Nothing tied the two together.
 *
 * detail.dev finding D125.
 *
 * @see {@link file://./service.server.ts} `removeAssetFromAudit`, `removeAssetsFromAudit`
 */

import { AuditStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import type * as noteService from "~/modules/note/service.server";

// why: no database in unit tests. The callback form of $transaction hands the
// same stub back as `tx`, which is what these functions write through.
const { mockDb } = vitest.hoisted(() => ({
  mockDb: {
    $transaction: vitest.fn(),
    auditSession: {
      findUnique: vitest.fn(),
      update: vitest.fn().mockResolvedValue({}),
    },
    auditAsset: {
      findFirst: vitest.fn(),
      findMany: vitest.fn(),
      delete: vitest.fn().mockResolvedValue({}),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    asset: {
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    // why: the SUCCESS path writes a removal note, which reads the actor and
    // the removed assets through the same tx. Not the subject of these tests,
    // but the bulk happy-path traverses it.
    user: {
      findUnique: vitest
        .fn()
        .mockResolvedValue({ id: "user-1", firstName: "A", lastName: "B" }),
    },
    note: { createMany: vitest.fn().mockResolvedValue({ count: 0 }) },
    // why: removal emits one activity event per removed asset through the same
    // tx (the bulk-event-parity rule). Stubbed so the happy path completes.
    activityEvent: { createMany: vitest.fn().mockResolvedValue({ count: 0 }) },
  },
}));
vitest.mock("~/database/db.server", () => ({ db: mockDb }));

// why: note writing is a side effect of removal, not the subject of this test,
// and it pulls in Markdoc wrappers and user lookups we do not need here.
vitest.mock("~/modules/note/service.server", async (importOriginal) => {
  const actual = await importOriginal<typeof noteService>();
  return {
    ...actual,
    createNotes: vitest.fn().mockResolvedValue({}),
    createNote: vitest.fn().mockResolvedValue({}),
    createAssetNotesForAuditRemoval: vitest.fn().mockResolvedValue({}),
  };
});

import { removeAssetFromAudit, removeAssetsFromAudit } from "./service.server";

// @vitest-environment node

const AUDIT_ID = "audit-mine";
const ORG_ID = "org-mine";

/** The victim's row: a real AuditAsset, belonging to a DIFFERENT audit. */
const FOREIGN_AUDIT_ASSET_ID = "auditasset-belonging-to-another-org";

describe("removeAssetFromAudit", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockDb)
    );
    // The caller's own audit — genuinely theirs, genuinely PENDING. This is
    // what made the bug reachable: every check that DID exist passed.
    mockDb.auditSession.findUnique.mockResolvedValue({
      id: AUDIT_ID,
      name: "My Audit",
      status: AuditStatus.PENDING,
    });
  });

  it("refuses an audit asset that belongs to a different audit", async () => {
    // The scoped lookup finds nothing, because the row is not in this audit.
    mockDb.auditAsset.findFirst.mockResolvedValue(null);

    await expect(
      removeAssetFromAudit({
        auditId: AUDIT_ID,
        auditAssetId: FOREIGN_AUDIT_ASSET_ID,
        organizationId: ORG_ID,
        userId: "user-1",
      })
    ).rejects.toThrow(/not found in this audit/);

    // The assertion that matters: nothing was deleted. A test that only
    // checked the throw would still pass if the delete ran first.
    expect(mockDb.auditAsset.delete).not.toHaveBeenCalled();
    expect(mockDb.auditAsset.deleteMany).not.toHaveBeenCalled();
    // …and the caller's own audit counts are untouched. The old code
    // decremented them off a row from someone else's audit.
    expect(mockDb.auditSession.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup by auditSessionId, not by id alone", async () => {
    mockDb.auditAsset.findFirst.mockResolvedValue(null);

    await expect(
      removeAssetFromAudit({
        auditId: AUDIT_ID,
        auditAssetId: FOREIGN_AUDIT_ASSET_ID,
        organizationId: ORG_ID,
        userId: "user-1",
      })
    ).rejects.toThrow();

    // Asserting the WHERE clause directly. `AuditAsset` has no organizationId
    // column, so this predicate is the entire tenant boundary — if a refactor
    // drops it, the row becomes globally addressable again.
    expect(mockDb.auditAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: FOREIGN_AUDIT_ASSET_ID,
          auditSessionId: AUDIT_ID,
        }),
      })
    );
  });

  it("does not reveal whether the id exists elsewhere", async () => {
    mockDb.auditAsset.findFirst.mockResolvedValue(null);

    const cause = await removeAssetFromAudit({
      auditId: AUDIT_ID,
      auditAssetId: FOREIGN_AUDIT_ASSET_ID,
      organizationId: ORG_ID,
      userId: "user-1",
    }).catch((e: unknown) => e);

    // Same 404 either way — a distinct "belongs to another audit" message
    // would confirm the id is real, which is an existence oracle.
    const err = cause as { status?: number; message?: string };
    expect(err.status).toBe(404);
    expect(err.message).not.toMatch(/another|other audit|different/i);
  });
});

describe("concurrent removal", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockDb)
    );
    mockDb.auditSession.findUnique.mockResolvedValue({
      id: AUDIT_ID,
      name: "My Audit",
      status: AuditStatus.PENDING,
    });
  });

  it("does not decrement counts when the row was already deleted", async () => {
    // Two simultaneous removals of the same asset. Both pass the read; the
    // second deletes nothing. `deleteMany` reports that as `{ count: 0 }`
    // rather than throwing the way `delete` did, so without an explicit check
    // the second request would still decrement the counters and write a
    // second note — double-counting a single removal.
    mockDb.auditAsset.findFirst.mockResolvedValue({
      assetId: "asset-1",
      expected: true,
    });
    mockDb.auditAsset.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      removeAssetFromAudit({
        auditId: AUDIT_ID,
        auditAssetId: "auditasset-mine",
        organizationId: ORG_ID,
        userId: "user-1",
      })
    ).rejects.toThrow(/not found in this audit/);

    expect(mockDb.auditSession.update).not.toHaveBeenCalled();
  });

  it("aborts a bulk removal when fewer rows were deleted than proven", async () => {
    // `expectedCount` is derived from the READ, so a concurrent removal would
    // make the decrement overshoot — and the `expected` flag needed to choose
    // the counter cannot be recovered from a row that is already gone.
    mockDb.auditAsset.findMany.mockResolvedValue([
      { id: "auditasset-1", assetId: "asset-1", expected: true },
      { id: "auditasset-2", assetId: "asset-2", expected: true },
    ]);
    mockDb.auditAsset.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      removeAssetsFromAudit({
        auditId: AUDIT_ID,
        auditAssetIds: ["auditasset-1", "auditasset-2"],
        organizationId: ORG_ID,
        userId: "user-1",
      })
    ).rejects.toThrow(/removed by someone else/);

    expect(mockDb.auditSession.update).not.toHaveBeenCalled();
  });
});

describe("removeAssetsFromAudit (bulk)", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    mockDb.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(mockDb)
    );
    mockDb.auditSession.findUnique.mockResolvedValue({
      id: AUDIT_ID,
      name: "My Audit",
      status: AuditStatus.PENDING,
    });
  });

  it("deletes only the ids proven to be in this audit", async () => {
    // One id is genuinely in this audit; the other belongs elsewhere and so
    // does not come back from the scoped read.
    mockDb.auditAsset.findMany.mockResolvedValue([
      { id: "auditasset-mine", assetId: "asset-1", expected: true },
    ]);
    // why: the delete-count guard compares this against the proven-id count.
    mockDb.auditAsset.deleteMany.mockResolvedValue({ count: 1 });

    await removeAssetsFromAudit({
      auditId: AUDIT_ID,
      auditAssetIds: ["auditasset-mine", FOREIGN_AUDIT_ASSET_ID],
      organizationId: ORG_ID,
      userId: "user-1",
    });

    // The delete must use the PROVEN ids, not the caller's original list —
    // passing the input list through would delete the foreign row even though
    // it was correctly excluded from the counts.
    expect(mockDb.auditAsset.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["auditasset-mine"] },
          auditSessionId: AUDIT_ID,
        }),
      })
    );
  });

  it("scopes the bulk read by auditSessionId", async () => {
    mockDb.auditAsset.findMany.mockResolvedValue([]);

    await removeAssetsFromAudit({
      auditId: AUDIT_ID,
      auditAssetIds: [FOREIGN_AUDIT_ASSET_ID],
      organizationId: ORG_ID,
      userId: "user-1",
    });

    expect(mockDb.auditAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ auditSessionId: AUDIT_ID }),
      })
    );
    // Nothing matched, so nothing is deleted at all.
    expect(mockDb.auditAsset.deleteMany).not.toHaveBeenCalled();
  });
});
