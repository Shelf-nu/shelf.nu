/**
 * Deleting a note from an audit's activity feed.
 *
 * Only comments are the author's to delete. The audit's own activity entries —
 * started, scanned, removed, completed — are UPDATE notes that carry the acting
 * user's id, so matching on the author alone would let someone erase the record
 * of what they did.
 *
 * @see {@link file://./../../../app/routes/_layout+/audits.$auditId.note.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import { db } from "~/database/db.server";
import type * as AuditService from "~/modules/audit/service.server";
import { createAuditNote } from "~/modules/audit/note-service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/_layout+/audits.$auditId.note";

// @vitest-environment node

// why: the audit lookup and the delete are the database calls under test; their
// arguments and results are asserted directly.
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    auditNote: { deleteMany: vi.fn() },
  },
}));

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the assignee gate is not what these cases vary, and an ADMIN caller is
// never restricted by it. The rest of the audit service stays real, including
// the comment-policy refusal under test.
vi.mock("~/modules/audit/service.server", async (importOriginal) => {
  const actual = await importOriginal<typeof AuditService>();
  return { ...actual, requireAuditAssigneeForBaseSelfService: vi.fn() };
});

// why: note creation is not exercised; the module writes through Prisma.
vi.mock("~/modules/audit/note-service.server", () => ({
  createAuditNote: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

async function deleteNote(noteId: string) {
  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/audits/audit-1/note", {
        method: "DELETE",
        body: new URLSearchParams({ noteId }),
      }),
      params: { auditId: "audit-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );
  assertIsDataWithResponseInit(response);
  return response.init?.status ?? 200;
}

describe("add a comment to an audit", () => {
  async function addComment(status: string) {
    vi.mocked(db.auditSession.findFirst).mockResolvedValue({
      id: "audit-1",
      organizationId: "org-1",
      status,
      assignments: [],
    } as never);

    const response = await action(
      createActionArgs({
        request: new Request("http://localhost/audits/audit-1/note", {
          method: "POST",
          body: new URLSearchParams({ content: "Lens cap missing" }),
        }),
        params: { auditId: "audit-1" },
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    );
    assertIsDataWithResponseInit(response);
    return response.init?.status ?? 200;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as never);
  });

  it("adds a comment to an audit that is still open", async () => {
    await addComment("ACTIVE");

    expect(createAuditNote).toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED", "ARCHIVED"])(
    "refuses a comment on a %s audit",
    async (status) => {
      expect(await addComment(status)).toBe(400);
      expect(createAuditNote).not.toHaveBeenCalled();
    }
  );
});

describe("delete an audit note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    } as never);
    vi.mocked(db.auditSession.findFirst).mockResolvedValue({
      id: "audit-1",
      organizationId: "org-1",
      assignments: [],
    } as never);
  });

  it("deletes only the author's comments on this audit", async () => {
    vi.mocked(db.auditNote.deleteMany).mockResolvedValue({ count: 1 });

    await deleteNote("note-1");

    expect(db.auditNote.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "note-1",
        userId: "user-1",
        type: "COMMENT",
        auditSessionId: "audit-1",
        auditSession: { organizationId: "org-1" },
      },
    });
  });

  it("refuses when nothing the author may delete matches", async () => {
    // An activity entry the author generated, or a note on another audit, is
    // excluded by the predicate and so matches nothing.
    vi.mocked(db.auditNote.deleteMany).mockResolvedValue({ count: 0 });

    expect(await deleteNote("update-note")).toBe(403);
  });
});
