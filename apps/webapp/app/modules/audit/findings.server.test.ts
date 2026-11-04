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
function row(id: string, title: string | null) {
  return { asset: { id, title }, images: [], notes: [] };
}

describe("getAuditFindingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads one page of assets with findings, in the caller's workspace", async () => {
    findMany.mockResolvedValue([row("a1", "Camera")]);
    count.mockResolvedValue(25);

    await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      page: 3,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          auditSessionId: "audit-1",
          auditSession: { organizationId: "org-1" },
        }),
        skip: 2 * AUDIT_FINDINGS_PAGE_SIZE,
        take: AUDIT_FINDINGS_PAGE_SIZE,
      })
    );
  });

  it("says whether another page follows", async () => {
    findMany.mockResolvedValue([row("a1", null)]);
    count.mockResolvedValue(AUDIT_FINDINGS_PAGE_SIZE + 1);

    const first = await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      page: 1,
    });
    const second = await getAuditFindingsPage({
      auditSessionId: "audit-1",
      organizationId: "org-1",
      page: 2,
    });

    expect(first).toMatchObject({ hasMore: true, totalFindings: 11 });
    expect(second.hasMore).toBe(false);
    // An asset without a title still gets a name to show.
    expect(first.findings[0]).toMatchObject({
      assetId: "a1",
      assetName: "Unknown",
    });
  });
});
