import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, count } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

// why: the database; the test pins what the page read asks it for.
vi.mock("~/database/db.server", () => ({
  db: { auditAsset: { findMany, count } },
}));

import {
  AUDIT_FINDINGS_PAGE_SIZE,
  getAuditFindingsPage,
} from "./findings.server";

/** An audit asset row as the page read selects it. */
function row(n: number) {
  return {
    id: `aa-${n}`,
    asset: { id: `asset-${n}`, title: `Asset ${String(n).padStart(2, "0")}` },
    images: [],
    notes: [],
  };
}

/** `count` rows, numbered from 1. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => row(i + 1));

describe("getAuditFindingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    count.mockResolvedValue(25);
  });

  it("reads the first page in the caller's workspace, one extra row to see past it", async () => {
    findMany.mockResolvedValue([]);

    await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
    });

    const query = findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      auditSessionId: "audit-1",
      auditSession: { organizationId: "org-1" },
    });
    expect(query.take).toBe(AUDIT_FINDINGS_PAGE_SIZE + 1);
    // Photos and notes must belong to this audit (and workspace) too: the
    // database links them to an audit asset by id alone.
    const imageScope = { auditSessionId: "audit-1", organizationId: "org-1" };
    const noteScope = { auditSessionId: "audit-1", type: "COMMENT" };
    expect(query.where.OR).toEqual([
      { images: { some: imageScope } },
      { notes: { some: noteScope } },
    ]);
    expect(query.select.images.where).toEqual(imageScope);
    expect(query.select.notes.where).toEqual(noteScope);
    expect(query.skip).toBeUndefined();
    expect(query.orderBy).toEqual([{ asset: { title: "asc" } }, { id: "asc" }]);
  });

  it("starts a later page strictly after the cursor row, in (title, id) order", async () => {
    findMany.mockResolvedValue([]);
    const after = { title: "Camera", id: "aa-7" };

    const result = await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      after,
    });

    // The cursor is a condition, not an offset: an earlier asset leaving the
    // set cannot move the next page's first row.
    expect(findMany.mock.calls[0][0].where.AND).toContainEqual({
      OR: [
        { asset: { title: { gt: "Camera" } } },
        { asset: { title: "Camera" }, id: { gt: "aa-7" } },
      ],
    });
    expect(result.after).toEqual(after);
  });

  it("returns a full page and the cursor of its last row when another follows", async () => {
    findMany.mockResolvedValue(rows(AUDIT_FINDINGS_PAGE_SIZE + 1));

    const result = await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
    });

    expect(result.findings).toHaveLength(AUDIT_FINDINGS_PAGE_SIZE);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({
      title: "Asset 10",
      id: "aa-10",
    });
    expect(result.totalFindings).toBe(25);
  });

  it("says there is no next page when the extra row is missing", async () => {
    findMany.mockResolvedValue(rows(3));

    const result = await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
    });

    expect(result.findings.map((f) => f.assetId)).toEqual([
      "asset-1",
      "asset-2",
      "asset-3",
    ]);
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
  });
});
