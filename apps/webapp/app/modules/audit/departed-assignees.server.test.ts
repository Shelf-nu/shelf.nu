// @vitest-environment node
/**
 * Unit tests for taking a departing member off a workspace's open audits.
 *
 * These pin which audits are touched (open ones only, in this workspace), that
 * every write goes through the membership-removal transaction, and that each
 * audit gets one event and one note.
 *
 * @see {@link file://./departed-assignees.server.ts}
 */
import { AuditStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordEvents } from "~/modules/activity-event/service.server";
import { removeDepartedMemberFromOpenAudits } from "./departed-assignees.server";

// why: recordEvents resolves the actor snapshot and writes ActivityEvent rows;
// its own tests cover that, these check what is handed to it and with which
// client.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvents: vi.fn(),
}));

/** A transaction client whose assignment table answers with `rows`. */
function txWith(rows: Array<{ id: string; auditSessionId: string }>) {
  return {
    auditAssignment: {
      findMany: vi.fn().mockResolvedValue(rows),
      deleteMany: vi.fn().mockResolvedValue({ count: rows.length }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        firstName: "Ana",
        lastName: "Tester",
        displayName: null,
      }),
    },
    auditNote: { createMany: vi.fn() },
  };
}

const args = {
  userId: "user-gone",
  organizationId: "org-1",
  actorUserId: "admin-1",
};

describe("removeDepartedMemberFromOpenAudits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks only at this workspace's pending and active audits", async () => {
    const tx = txWith([]);

    await removeDepartedMemberFromOpenAudits(tx as never, args);

    expect(tx.auditAssignment.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-gone",
        auditSession: {
          organizationId: "org-1",
          status: { in: [AuditStatus.PENDING, AuditStatus.ACTIVE] },
        },
      },
      select: { id: true, auditSessionId: true },
    });
  });

  it("writes nothing when the member is on no open audit", async () => {
    const tx = txWith([]);

    await expect(
      removeDepartedMemberFromOpenAudits(tx as never, args)
    ).resolves.toEqual([]);

    expect(tx.auditAssignment.deleteMany).not.toHaveBeenCalled();
    expect(recordEvents).not.toHaveBeenCalled();
    expect(tx.auditNote.createMany).not.toHaveBeenCalled();
  });

  it("deletes the assignments and records one event and one note per audit", async () => {
    const tx = txWith([
      { id: "as-1", auditSessionId: "audit-1" },
      { id: "as-2", auditSessionId: "audit-2" },
    ]);

    await expect(
      removeDepartedMemberFromOpenAudits(tx as never, args)
    ).resolves.toEqual(["audit-1", "audit-2"]);

    expect(tx.auditAssignment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["as-1", "as-2"] } },
    });

    const removal = (auditSessionId: string) => ({
      organizationId: "org-1",
      actorUserId: "admin-1",
      action: "AUDIT_ASSIGNEE_REMOVED",
      entityType: "AUDIT",
      entityId: auditSessionId,
      auditSessionId,
      targetUserId: "user-gone",
    });
    // The transaction client is passed, so the events roll back with the
    // membership removal.
    expect(recordEvents).toHaveBeenCalledWith(
      [removal("audit-1"), removal("audit-2")],
      tx
    );

    const notes = tx.auditNote.createMany.mock.calls[0][0].data;
    expect(
      notes.map((note: { auditSessionId: string }) => note.auditSessionId)
    ).toEqual(["audit-1", "audit-2"]);
    expect(notes[0]).toMatchObject({
      userId: "admin-1",
      type: "UPDATE",
      content: expect.stringContaining('text="Ana Tester"'),
    });
    expect(notes[0].content).toContain("removed from the workspace");
  });

  it("writes system removals with no actor", async () => {
    const tx = txWith([{ id: "as-1", auditSessionId: "audit-1" }]);

    await removeDepartedMemberFromOpenAudits(tx as never, {
      ...args,
      actorUserId: null,
    });

    expect(vi.mocked(recordEvents).mock.calls[0][0][0]).toMatchObject({
      actorUserId: null,
    });
    expect(tx.auditNote.createMany.mock.calls[0][0].data[0].userId).toBeNull();
  });
});
