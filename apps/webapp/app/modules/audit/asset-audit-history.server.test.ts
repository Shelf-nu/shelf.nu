/**
 * Asset audit history service: the two queries behind the hover card.
 *
 * @see {@link file://./asset-audit-history.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { getAssetAuditHistory } from "./asset-audit-history.server";

// why: the service is a thin pair of Prisma reads; the test pins the query
// shape without a database.
vi.mock("~/database/db.server", () => ({
  db: { auditAsset: { findMany: vi.fn() } },
}));

const findMany = vi.mocked(db.auditAsset.findMany);

/** An audit asset row as the select returns it. */
function row(id: string, status: string, assetStatus: string) {
  return {
    status: assetStatus,
    auditSession: {
      id,
      name: `Audit ${id}`,
      status,
      completedAt: null,
      dueDate: null,
    },
  };
}

describe("getAssetAuditHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([] as never);
  });

  it("queries counted audits newest first, capped at 3 by default", async () => {
    await getAssetAuditHistory({ assetId: "a1", organizationId: "org-1" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId: "a1",
          auditSession: {
            organizationId: "org-1",
            status: { in: ["COMPLETED", "ARCHIVED"] },
            completedAt: { not: null },
          },
        },
        orderBy: [
          { auditSession: { completedAt: "desc" } },
          { auditSession: { createdAt: "desc" } },
        ],
        take: 3,
      })
    );
  });

  it("queries upcoming audits by due date with undated last, then creation", async () => {
    await getAssetAuditHistory({
      assetId: "a1",
      organizationId: "org-1",
      limit: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetId: "a1",
          auditSession: {
            organizationId: "org-1",
            status: { in: ["PENDING", "ACTIVE"] },
          },
        },
        orderBy: [
          { auditSession: { dueDate: { sort: "asc", nulls: "last" } } },
          { auditSession: { createdAt: "asc" } },
        ],
        take: 5,
      })
    );
  });

  it("maps the asset's own audit status onto each item", async () => {
    // Call order matches the service: recent first, then upcoming.
    findMany
      .mockResolvedValueOnce([row("done", "COMPLETED", "FOUND")] as never)
      .mockResolvedValueOnce([row("next", "ACTIVE", "PENDING")] as never);

    const result = await getAssetAuditHistory({
      assetId: "a1",
      organizationId: "org-1",
    });

    expect(result.recent).toEqual([
      expect.objectContaining({
        id: "done",
        status: "COMPLETED",
        assetStatus: "FOUND",
      }),
    ]);
    expect(result.upcoming).toEqual([
      expect.objectContaining({
        id: "next",
        status: "ACTIVE",
        assetStatus: "PENDING",
      }),
    ]);
  });
});
