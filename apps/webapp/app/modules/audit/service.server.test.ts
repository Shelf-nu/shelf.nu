import { AuditStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  createAuditSession,
  addAssetsToAudit,
  removeAssetFromAudit,
  removeAssetsFromAudit,
  getPendingAuditsForOrganization,
  getAuditWhereInput,
  bulkArchiveAudits,
  deleteAuditSession,
  bulkDeleteAudits,
} from "./service.server";

// why: storage.server calls Supabase over HTTP; mock so delete tests stay offline
vi.mock("~/utils/storage.server", () => ({
  removePublicFile: vi.fn(),
}));

// why: Mock the helper functions that create automatic notes to avoid database dependencies in unit tests
vi.mock("./helpers.server", () => ({
  createAuditCreationNote: vi.fn(),
  createAssetScanNote: vi.fn(),
  createAssetsAddedToAuditNote: vi.fn(),
  createAssetRemovedFromAuditNote: vi.fn(),
  createAssetsRemovedFromAuditNote: vi.fn(),
}));

// why: deterministic note content for assertions; real impl returns markdoc syntax
vi.mock("~/utils/markdoc-wrappers", () => ({
  wrapUserLinkForNote: vi.fn(
    ({ firstName, lastName }) => `@${firstName ?? ""}-${lastName ?? ""}`
  ),
}));

vi.mock("~/database/db.server", () => {
  const mockDb = {
    auditSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditNote: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    auditAsset: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditAssignment: {
      createMany: vi.fn(),
    },
    auditImage: {
      findMany: vi.fn(),
    },
    asset: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  mockDb.$transaction.mockImplementation((cb: any) => cb(mockDb));

  return { db: mockDb };
});

const mockDb = db as unknown as {
  auditSession: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  auditNote: {
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  auditAsset: {
    createMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  auditAssignment: {
    createMany: ReturnType<typeof vi.fn>;
  };
  auditImage: {
    findMany: ReturnType<typeof vi.fn>;
  };
  asset: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("audit service", () => {
  const defaultInput = {
    name: "Quarterly warehouse audit",
    description: "Check top 10 cameras",
    assetIds: ["asset-1", "asset-2"],
    organizationId: "org-1",
    createdById: "user-1",
    assignee: "user-2",
    scopeMeta: {
      contextType: "SELECTION",
      contextName: "Quarterly warehouse audit",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Camera A" },
      { id: "asset-2", title: "Camera B" },
    ]);
    mockDb.auditSession.create.mockResolvedValue({
      id: "audit-1",
      name: defaultInput.name,
      description: defaultInput.description,
      organizationId: defaultInput.organizationId,
      createdById: defaultInput.createdById,
      expectedAssetCount: 2,
      foundAssetCount: 0,
      missingAssetCount: 2,
      unexpectedAssetCount: 0,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      status: "PENDING",
      scopeMeta: defaultInput.scopeMeta,
      targetId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockDb.auditSession.findUnique.mockResolvedValue({
      id: "audit-1",
      name: defaultInput.name,
      description: defaultInput.description,
      organizationId: defaultInput.organizationId,
      createdById: defaultInput.createdById,
      expectedAssetCount: 2,
      foundAssetCount: 0,
      missingAssetCount: 2,
      unexpectedAssetCount: 0,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      status: "PENDING",
      scopeMeta: defaultInput.scopeMeta,
      targetId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignments: [
        {
          id: "assignment-1",
          auditSessionId: "audit-1",
          userId: "user-2",
          role: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      assets: [],
    });
    mockDb.auditAsset.createMany.mockResolvedValue({ count: 2 });
    mockDb.auditAssignment.createMany.mockResolvedValue({ count: 1 });
    mockDb.auditAsset.findMany.mockResolvedValue([
      {
        id: "audit-asset-1",
        assetId: "asset-1",
        auditSessionId: "audit-1",
        expected: true,
      },
      {
        id: "audit-asset-2",
        assetId: "asset-2",
        auditSessionId: "audit-1",
        expected: true,
      },
    ]);
  });

  it("creates an audit session with expected assets and assignments", async () => {
    const result = await createAuditSession(defaultInput);

    expect(mockDb.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-1", "asset-2"] },
        organizationId: "org-1",
      },
      select: { id: true, title: true },
    });

    expect(mockDb.auditSession.create).toHaveBeenCalledWith({
      data: {
        name: defaultInput.name,
        description: defaultInput.description,
        organizationId: defaultInput.organizationId,
        createdById: defaultInput.createdById,
        expectedAssetCount: 2,
        missingAssetCount: 2,
        scopeMeta: defaultInput.scopeMeta,
      },
    });

    expect(mockDb.auditAsset.createMany).toHaveBeenCalledWith({
      data: [
        { auditSessionId: "audit-1", assetId: "asset-1", expected: true },
        { auditSessionId: "audit-1", assetId: "asset-2", expected: true },
      ],
    });

    expect(mockDb.auditAssignment.createMany).toHaveBeenCalledWith({
      data: [{ auditSessionId: "audit-1", userId: "user-2", role: undefined }],
    });

    expect(result.expectedAssets).toEqual([
      { id: "asset-1", name: "Camera A", auditAssetId: "audit-asset-1" },
      { id: "asset-2", name: "Camera B", auditAssetId: "audit-asset-2" },
    ]);
    expect(result.session.assignments).toHaveLength(1);
  });

  it("throws when no assets are provided", async () => {
    await expect(
      createAuditSession({ ...defaultInput, assetIds: [] })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("throws when assets are missing", async () => {
    mockDb.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Camera A" },
    ]);
    await expect(createAuditSession(defaultInput)).rejects.toBeInstanceOf(
      ShelfError
    );
  });

  it("deduplicates asset and assignee ids", async () => {
    mockDb.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Camera A" },
    ]);

    await createAuditSession({
      ...defaultInput,
      assetIds: ["asset-1", "asset-1"],
    });

    expect(mockDb.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-1"] },
        organizationId: "org-1",
      },
      select: { id: true, title: true },
    });

    expect(mockDb.auditAsset.createMany).toHaveBeenCalledWith({
      data: [{ auditSessionId: "audit-1", assetId: "asset-1", expected: true }],
    });

    expect(mockDb.auditAssignment.createMany).toHaveBeenCalledWith({
      data: [{ auditSessionId: "audit-1", userId: "user-2", role: undefined }],
    });
  });

  describe("getPendingAuditsForOrganization", () => {
    it("returns pending audits for organization", async () => {
      const mockAudits = [
        {
          id: "audit-1",
          name: "Warehouse Audit Q1",
          createdAt: new Date("2025-01-15"),
          expectedAssetCount: 50,
          createdBy: { firstName: "John", lastName: "Doe" },
          assignments: [{ user: { firstName: "Jane", lastName: "Smith" } }],
        },
        {
          id: "audit-2",
          name: "Office Audit",
          createdAt: new Date("2025-01-20"),
          expectedAssetCount: 25,
          createdBy: { firstName: "Bob", lastName: "Wilson" },
          assignments: [],
        },
      ];

      mockDb.auditSession.findMany.mockResolvedValue(mockAudits);

      const result = await getPendingAuditsForOrganization({
        organizationId: "org-1",
      });

      expect(mockDb.auditSession.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          status: "PENDING",
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
          expectedAssetCount: true,
          createdBy: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          assignments: {
            select: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  displayName: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      expect(result).toEqual(mockAudits);
    });
  });

  describe("addAssetsToAudit", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("adds new assets to pending audit", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findMany.mockResolvedValue([]);

      const result = await addAssetsToAudit({
        auditId: "audit-1",
        assetIds: ["asset-1", "asset-2"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditSession.findUnique).toHaveBeenCalledWith({
        where: { id: "audit-1", organizationId: "org-1" },
        select: { id: true, name: true, status: true },
      });

      expect(mockDb.auditAsset.createMany).toHaveBeenCalledWith({
        data: [
          {
            auditSessionId: "audit-1",
            assetId: "asset-1",
            expected: true,
            status: "PENDING",
          },
          {
            auditSessionId: "audit-1",
            assetId: "asset-2",
            expected: true,
            status: "PENDING",
          },
        ],
      });

      expect(mockDb.auditSession.update).toHaveBeenCalledWith({
        where: { id: "audit-1" },
        data: {
          expectedAssetCount: { increment: 2 },
          missingAssetCount: { increment: 2 },
        },
      });

      expect(result).toEqual({
        addedCount: 2,
        skippedCount: 0,
      });
    });

    it("filters out duplicate assets", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findMany.mockResolvedValue([{ assetId: "asset-1" }]);

      const result = await addAssetsToAudit({
        auditId: "audit-1",
        assetIds: ["asset-1", "asset-2", "asset-3"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditAsset.createMany).toHaveBeenCalledWith({
        data: [
          {
            auditSessionId: "audit-1",
            assetId: "asset-2",
            expected: true,
            status: "PENDING",
          },
          {
            auditSessionId: "audit-1",
            assetId: "asset-3",
            expected: true,
            status: "PENDING",
          },
        ],
      });

      expect(result).toEqual({
        addedCount: 2,
        skippedCount: 1,
      });
    });

    it("throws error when audit not found", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue(null);

      await expect(
        addAssetsToAudit({
          auditId: "nonexistent-audit",
          assetIds: ["asset-1"],
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });

    it("throws error when audit is not PENDING", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "COMPLETED",
      });

      await expect(
        addAssetsToAudit({
          auditId: "audit-1",
          assetIds: ["asset-1"],
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });
  });

  describe("removeAssetFromAudit", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("removes expected asset from pending audit", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findUnique.mockResolvedValue({
        assetId: "asset-1",
        expected: true,
      });

      await removeAssetFromAudit({
        auditId: "audit-1",
        auditAssetId: "audit-asset-1",
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditSession.findUnique).toHaveBeenCalledWith({
        where: { id: "audit-1", organizationId: "org-1" },
        select: { id: true, name: true, status: true },
      });

      expect(mockDb.auditAsset.delete).toHaveBeenCalledWith({
        where: { id: "audit-asset-1" },
      });

      expect(mockDb.auditSession.update).toHaveBeenCalledWith({
        where: { id: "audit-1" },
        data: {
          expectedAssetCount: { decrement: 1 },
          missingAssetCount: { decrement: 1 },
        },
      });
    });

    it("removes unexpected asset without decrementing counts", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findUnique.mockResolvedValue({
        assetId: "asset-1",
        expected: false,
      });

      await removeAssetFromAudit({
        auditId: "audit-1",
        auditAssetId: "audit-asset-1",
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditAsset.delete).toHaveBeenCalled();
      expect(mockDb.auditSession.update).not.toHaveBeenCalled();
    });

    it("throws error when audit not found", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue(null);

      await expect(
        removeAssetFromAudit({
          auditId: "nonexistent-audit",
          auditAssetId: "audit-asset-1",
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });

    it("throws error when audit is not PENDING", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        status: "ACTIVE",
      });

      await expect(
        removeAssetFromAudit({
          auditId: "audit-1",
          auditAssetId: "audit-asset-1",
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });

    it("throws error when audit asset not found", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        status: "PENDING",
      });
      mockDb.auditAsset.findUnique.mockResolvedValue(null);

      await expect(
        removeAssetFromAudit({
          auditId: "audit-1",
          auditAssetId: "nonexistent-asset",
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });
  });

  describe("removeAssetsFromAudit", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("removes multiple assets from pending audit", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findMany.mockResolvedValue([
        { id: "audit-asset-1", assetId: "asset-1", expected: true },
        { id: "audit-asset-2", assetId: "asset-2", expected: true },
        { id: "audit-asset-3", assetId: "asset-3", expected: false },
      ]);

      const result = await removeAssetsFromAudit({
        auditId: "audit-1",
        auditAssetIds: ["audit-asset-1", "audit-asset-2", "audit-asset-3"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditAsset.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["audit-asset-1", "audit-asset-2", "audit-asset-3"] },
        },
      });

      expect(mockDb.auditSession.update).toHaveBeenCalledWith({
        where: { id: "audit-1" },
        data: {
          expectedAssetCount: { decrement: 2 },
          missingAssetCount: { decrement: 2 },
        },
      });

      expect(result).toEqual({ removedCount: 3 });
    });

    it("returns zero when no assets found", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      });
      mockDb.auditAsset.findMany.mockResolvedValue([]);

      const result = await removeAssetsFromAudit({
        auditId: "audit-1",
        auditAssetIds: ["nonexistent-1", "nonexistent-2"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(mockDb.auditAsset.deleteMany).not.toHaveBeenCalled();
      expect(result).toEqual({ removedCount: 0 });
    });

    it("throws error when audit not found", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue(null);

      await expect(
        removeAssetsFromAudit({
          auditId: "nonexistent-audit",
          auditAssetIds: ["audit-asset-1"],
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });

    it("throws error when audit is not PENDING", async () => {
      mockDb.auditSession.findUnique.mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "COMPLETED",
      });

      await expect(
        removeAssetsFromAudit({
          auditId: "audit-1",
          auditAssetIds: ["audit-asset-1"],
          organizationId: "org-1",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);
    });
  });

  describe("bulk archive", () => {
    describe("getAuditWhereInput", () => {
      it("excludes ARCHIVED by default when no params are provided", () => {
        const where = getAuditWhereInput({ organizationId: "org-1" });

        expect(where).toEqual({
          organizationId: "org-1",
          status: { notIn: [AuditStatus.ARCHIVED] },
        });
      });

      it("applies an explicit status when provided", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "status=COMPLETED",
        });

        expect(where).toEqual({
          organizationId: "org-1",
          status: "COMPLETED",
        });
      });

      it("normalizes lowercase status values to uppercase", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "status=completed",
        });

        expect(where.status).toBe("COMPLETED");
      });

      it("falls through to default when status=ALL", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "status=ALL",
        });

        expect(where.status).toEqual({ notIn: [AuditStatus.ARCHIVED] });
      });

      it("falls back to default for an unknown status value", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "status=garbage",
        });

        expect(where.status).toEqual({ notIn: [AuditStatus.ARCHIVED] });
      });

      it("applies a case-insensitive OR search for the `s` param", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "s=camera",
        });

        expect(where.OR).toEqual([
          { name: { contains: "camera", mode: "insensitive" } },
          { description: { contains: "camera", mode: "insensitive" } },
        ]);
      });

      it("scopes to the user's assignments when isSelfServiceOrBase with userId", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          userId: "user-1",
          isSelfServiceOrBase: true,
        });

        expect(where.assignments).toEqual({ some: { userId: "user-1" } });
      });

      it("does not apply the assignments filter when isSelfServiceOrBase is false", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          userId: "user-1",
          isSelfServiceOrBase: false,
        });

        expect(where.assignments).toBeUndefined();
      });

      it("does not apply the assignments filter when userId is missing", () => {
        const where = getAuditWhereInput({
          organizationId: "org-1",
          isSelfServiceOrBase: true,
        });

        expect(where.assignments).toBeUndefined();
      });
    });

    describe("bulkArchiveAudits", () => {
      const matchingAudits = [
        { id: "a1", status: AuditStatus.COMPLETED },
        { id: "a2", status: AuditStatus.CANCELLED },
      ];

      beforeEach(() => {
        vi.clearAllMocks();
        // why: re-install the $transaction behavior after clearAllMocks wipes it
        mockDb.$transaction.mockImplementation((cb: any) => cb(mockDb));
        // why: default selection is all-terminal so the happy path works without per-test setup
        mockDb.auditSession.findMany.mockResolvedValue(matchingAudits);
        // why: updateMany.count must match findMany length to satisfy the TOCTOU guard
        mockDb.auditSession.updateMany.mockResolvedValue({
          count: matchingAudits.length,
        });
        // why: note generation reads user display name; return a deterministic identity
        mockDb.user.findFirst.mockResolvedValue({
          firstName: "Jane",
          lastName: "Doe",
        });
        mockDb.auditNote.createMany.mockResolvedValue({
          count: matchingAudits.length,
        });
      });

      it("archives explicit terminal audits and writes an activity note per audit", async () => {
        await bulkArchiveAudits({
          auditIds: ["a1", "a2"],
          organizationId: "org-1",
          userId: "user-1",
        });

        expect(mockDb.auditSession.updateMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["a1", "a2"] },
            status: {
              in: [AuditStatus.COMPLETED, AuditStatus.CANCELLED],
            },
          },
          data: { status: AuditStatus.ARCHIVED },
        });

        expect(mockDb.auditNote.createMany).toHaveBeenCalledWith({
          data: [
            {
              content: "@Jane-Doe archived the audit",
              type: "UPDATE",
              userId: "user-1",
              auditSessionId: "a1",
            },
            {
              content: "@Jane-Doe archived the audit",
              type: "UPDATE",
              userId: "user-1",
              auditSessionId: "a2",
            },
          ],
        });
      });

      it("rejects with ShelfError when no archivable audits are found", async () => {
        mockDb.auditSession.findMany.mockResolvedValue([]);

        await expect(
          bulkArchiveAudits({
            auditIds: ["a1"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toThrow(/No archivable audits were found/);
      });

      it("rejects when any selected audit is not in a terminal state", async () => {
        mockDb.auditSession.findMany.mockResolvedValue([
          { id: "a1", status: AuditStatus.COMPLETED },
          { id: "a2", status: AuditStatus.PENDING },
        ]);

        await expect(
          bulkArchiveAudits({
            auditIds: ["a1", "a2"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toThrow(/not in a completed or cancelled state/);
      });

      it("resolves selection from filters when ALL_SELECTED_KEY is present", async () => {
        await bulkArchiveAudits({
          auditIds: [ALL_SELECTED_KEY],
          currentSearchParams: "status=COMPLETED",
          organizationId: "org-1",
          userId: "user-1",
          isSelfServiceOrBase: true,
        });

        const expectedWhere = getAuditWhereInput({
          organizationId: "org-1",
          currentSearchParams: "status=COMPLETED",
          userId: "user-1",
          isSelfServiceOrBase: true,
        });

        expect(mockDb.auditSession.findMany.mock.calls[0][0].where).toEqual(
          expectedWhere
        );
      });

      it("rejects with 409 when updateMany.count does not match the pre-read", async () => {
        mockDb.auditSession.findMany.mockResolvedValue([
          { id: "a1", status: AuditStatus.COMPLETED },
          { id: "a2", status: AuditStatus.CANCELLED },
          { id: "a3", status: AuditStatus.COMPLETED },
        ]);
        mockDb.auditSession.updateMany.mockResolvedValue({ count: 2 });

        await expect(
          bulkArchiveAudits({
            auditIds: ["a1", "a2", "a3"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringMatching(/status changed/),
        });
      });

      it("reads the user before opening the transaction", async () => {
        await bulkArchiveAudits({
          auditIds: ["a1", "a2"],
          organizationId: "org-1",
          userId: "user-1",
        });

        const userCallOrder = mockDb.user.findFirst.mock.invocationCallOrder[0];
        const transactionCallOrder =
          mockDb.$transaction.mock.invocationCallOrder[0];

        expect(userCallOrder).toBeLessThan(transactionCallOrder);
      });

      it("wraps unknown causes in a 500 ShelfError", async () => {
        mockDb.auditSession.findMany.mockRejectedValue(new Error("boom"));

        await expect(
          bulkArchiveAudits({
            auditIds: ["a1"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 500,
          message: expect.stringMatching(/Failed to bulk archive audits/),
        });
      });
    });
  });

  describe("delete", () => {
    describe("deleteAuditSession", () => {
      // Shared happy-path input — tests override individual fields as needed.
      const baseInput = {
        auditSessionId: "audit-1",
        organizationId: "org-1",
        userId: "user-1",
        expectedName: "Q4 Audit",
      };

      beforeEach(() => {
        vi.clearAllMocks();
        // why: default to an archived audit so happy-path tests don't need per-test findFirst setup
        mockDb.auditSession.findFirst.mockResolvedValue({
          id: "audit-1",
          status: AuditStatus.ARCHIVED,
          name: "Q4 Audit",
        });
        mockDb.auditImage.findMany.mockResolvedValue([]);
        mockDb.auditSession.deleteMany.mockResolvedValue({ count: 1 });
      });

      it("deletes an archived audit via deleteMany with an ARCHIVED guard", async () => {
        await deleteAuditSession(baseInput);

        expect(mockDb.auditSession.findFirst).toHaveBeenCalledWith({
          where: { id: "audit-1", organizationId: "org-1" },
          select: { id: true, status: true, name: true },
        });

        expect(mockDb.auditSession.deleteMany).toHaveBeenCalledWith({
          where: {
            id: "audit-1",
            organizationId: "org-1",
            status: AuditStatus.ARCHIVED,
          },
        });
      });

      it("accepts the confirmation after trim + NFC + case-insensitive compare", async () => {
        // DB name is NFC-composed "Résumé Q4"; user types a lowercase,
        // whitespace-padded, NFD-decomposed variant. All three get normalized
        // away before the compare.
        mockDb.auditSession.findFirst.mockResolvedValue({
          id: "audit-1",
          status: AuditStatus.ARCHIVED,
          name: "Résumé Q4".normalize("NFC"),
        });

        await expect(
          deleteAuditSession({
            ...baseInput,
            expectedName: "  résumé q4  ".normalize("NFD"),
          })
        ).resolves.toBeUndefined();

        expect(mockDb.auditSession.deleteMany).toHaveBeenCalled();
      });

      it("rejects with 400 when the confirmation doesn't match the audit name", async () => {
        await expect(
          deleteAuditSession({ ...baseInput, expectedName: "Wrong Name" })
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/Confirmation did not match/),
        });

        expect(mockDb.auditSession.deleteMany).not.toHaveBeenCalled();
      });

      it("runs storage cleanup for each image AFTER the DB delete commits", async () => {
        mockDb.auditImage.findMany.mockResolvedValue([
          {
            id: "img-1",
            imageUrl: "https://s.example.com/i1.jpg",
            thumbnailUrl: "https://s.example.com/i1-thumb.jpg",
          },
          {
            id: "img-2",
            imageUrl: "https://s.example.com/i2.jpg",
            thumbnailUrl: null,
          },
        ]);

        // why: import inside the test so the mocked module is bound correctly
        const { removePublicFile } = await import("~/utils/storage.server");

        await deleteAuditSession(baseInput);

        expect(removePublicFile).toHaveBeenCalledWith({
          publicUrl: "https://s.example.com/i1.jpg",
        });
        expect(removePublicFile).toHaveBeenCalledWith({
          publicUrl: "https://s.example.com/i1-thumb.jpg",
        });
        expect(removePublicFile).toHaveBeenCalledWith({
          publicUrl: "https://s.example.com/i2.jpg",
        });
        // thumbnailUrl was null on img-2; only the main URL should be attempted
        expect(removePublicFile).toHaveBeenCalledTimes(3);

        // Ordering matters: the DB delete must have happened before the
        // first storage call. A zombie DB row pointing at deleted files is
        // strictly worse than a stale file pointing at a deleted row.
        const deleteOrder =
          mockDb.auditSession.deleteMany.mock.invocationCallOrder[0];
        const firstStorageOrder =
          vi.mocked(removePublicFile).mock.invocationCallOrder[0];
        expect(deleteOrder).toBeLessThan(firstStorageOrder);
      });

      it("swallows storage failures and still deletes the DB row", async () => {
        mockDb.auditImage.findMany.mockResolvedValue([
          {
            id: "img-1",
            imageUrl: "https://s.example.com/i1.jpg",
            thumbnailUrl: null,
          },
        ]);

        const { removePublicFile } = await import("~/utils/storage.server");
        vi.mocked(removePublicFile).mockRejectedValueOnce(new Error("s3 down"));

        await expect(deleteAuditSession(baseInput)).resolves.toBeUndefined();

        expect(mockDb.auditSession.deleteMany).toHaveBeenCalled();
      });

      it("rejects with 404 when the audit is not found", async () => {
        mockDb.auditSession.findFirst.mockResolvedValue(null);

        await expect(
          deleteAuditSession({ ...baseInput, auditSessionId: "missing" })
        ).rejects.toMatchObject({
          status: 404,
          message: expect.stringMatching(/Audit not found/),
        });

        expect(mockDb.auditSession.deleteMany).not.toHaveBeenCalled();
      });

      it.each([
        AuditStatus.PENDING,
        AuditStatus.ACTIVE,
        AuditStatus.COMPLETED,
        AuditStatus.CANCELLED,
      ])(
        "rejects with 409 when status is %s (not ARCHIVED)",
        async (status) => {
          mockDb.auditSession.findFirst.mockResolvedValue({
            id: "audit-1",
            status,
            name: "Q4 Audit",
          });

          await expect(deleteAuditSession(baseInput)).rejects.toMatchObject({
            status: 409,
            message: expect.stringMatching(
              /Only archived audits can be deleted/
            ),
          });

          expect(mockDb.auditSession.deleteMany).not.toHaveBeenCalled();
        }
      );

      it("rejects with 409 when the atomic deleteMany finds nothing (TOCTOU race)", async () => {
        mockDb.auditSession.deleteMany.mockResolvedValue({ count: 0 });

        await expect(deleteAuditSession(baseInput)).rejects.toMatchObject({
          status: 409,
          message: expect.stringMatching(/status may have changed/),
        });
      });

      it("does NOT touch storage when the guarded deleteMany finds nothing", async () => {
        // Regression guard: an earlier version cleaned storage BEFORE the
        // guarded DB delete, which orphaned files whenever a concurrent
        // status change turned the deleteMany into a no-op. Files now must
        // survive the race.
        mockDb.auditImage.findMany.mockResolvedValue([
          {
            id: "img-1",
            imageUrl: "https://s.example.com/i1.jpg",
            thumbnailUrl: "https://s.example.com/i1-thumb.jpg",
          },
        ]);
        mockDb.auditSession.deleteMany.mockResolvedValue({ count: 0 });

        const { removePublicFile } = await import("~/utils/storage.server");

        await expect(deleteAuditSession(baseInput)).rejects.toMatchObject({
          status: 409,
        });

        expect(removePublicFile).not.toHaveBeenCalled();
      });

      it("wraps unknown causes in a 500 ShelfError", async () => {
        mockDb.auditSession.findFirst.mockRejectedValue(new Error("boom"));

        await expect(deleteAuditSession(baseInput)).rejects.toMatchObject({
          status: 500,
          message: expect.stringMatching(/Failed to delete audit session/),
        });
      });
    });

    describe("bulkDeleteAudits", () => {
      const archivedAudits = [
        { id: "a1", status: AuditStatus.ARCHIVED },
        { id: "a2", status: AuditStatus.ARCHIVED },
      ];

      beforeEach(() => {
        vi.clearAllMocks();
        // why: re-install the $transaction behavior after clearAllMocks wipes it
        mockDb.$transaction.mockImplementation((cb: any) => cb(mockDb));
        mockDb.auditSession.findMany.mockResolvedValue(archivedAudits);
        mockDb.auditImage.findMany.mockResolvedValue([]);
        mockDb.auditSession.deleteMany.mockResolvedValue({
          count: archivedAudits.length,
        });
      });

      it("deletes archived audits narrowed by ARCHIVED status on the write", async () => {
        const result = await bulkDeleteAudits({
          auditIds: ["a1", "a2"],
          organizationId: "org-1",
          userId: "user-1",
        });

        expect(mockDb.auditSession.findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["a1", "a2"] },
            organizationId: "org-1",
            status: AuditStatus.ARCHIVED,
          },
          select: { id: true, status: true },
        });

        expect(mockDb.auditSession.deleteMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["a1", "a2"] },
            organizationId: "org-1",
            status: AuditStatus.ARCHIVED,
          },
        });

        expect(result).toEqual({ count: 2 });
      });

      it("rejects with 400 when no archivable audits are found", async () => {
        mockDb.auditSession.findMany.mockResolvedValue([]);

        await expect(
          bulkDeleteAudits({
            auditIds: ["a1"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/No deletable audits were found/),
        });
      });

      it("rejects when the explicit selection includes non-archived audit ids", async () => {
        // Pre-read only returns the subset that's actually ARCHIVED — "a2"
        // is missing, which means the user selected something non-archived.
        mockDb.auditSession.findMany.mockResolvedValue([
          { id: "a1", status: AuditStatus.ARCHIVED },
        ]);

        await expect(
          bulkDeleteAudits({
            auditIds: ["a1", "a2"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringMatching(/are not archived/),
        });

        expect(mockDb.auditSession.deleteMany).not.toHaveBeenCalled();
      });

      it.each([
        ["status=COMPLETED", "COMPLETED"],
        ["status=PENDING", "PENDING"],
        ["status=ALL", "ALL"],
        ["", undefined],
      ])(
        "rejects select-all (ALL_SELECTED_KEY) when params status=%s",
        async (params, _paramStatus) => {
          await expect(
            bulkDeleteAudits({
              auditIds: [ALL_SELECTED_KEY],
              currentSearchParams: params,
              organizationId: "org-1",
              userId: "user-1",
            })
          ).rejects.toMatchObject({
            status: 400,
            message: expect.stringMatching(
              /Select-all delete requires.*Archived/
            ),
          });

          // Must fail fast — before the findMany pre-read runs.
          expect(mockDb.auditSession.findMany).not.toHaveBeenCalled();
        }
      );

      it("accepts select-all when params explicitly narrow to ARCHIVED (case-insensitive)", async () => {
        await bulkDeleteAudits({
          auditIds: [ALL_SELECTED_KEY],
          currentSearchParams: "status=archived",
          organizationId: "org-1",
          userId: "user-1",
        });

        const whereArg = mockDb.auditSession.findMany.mock.calls[0][0].where;
        // Force-narrow to ARCHIVED must survive even when the caller sends
        // lowercase, and the org scope is always present.
        expect(whereArg.status).toBe(AuditStatus.ARCHIVED);
        expect(whereArg.organizationId).toBe("org-1");
        // PermissionAction.delete is ADMIN/OWNER-only, so assignments-based
        // scoping has no place here — guard against re-introduction.
        expect(whereArg.assignments).toBeUndefined();
      });

      it("calls removePublicFile for every image AFTER the DB transaction commits", async () => {
        mockDb.auditImage.findMany.mockResolvedValue([
          {
            id: "img-1",
            imageUrl: "https://s.example.com/a1.jpg",
            thumbnailUrl: null,
          },
          {
            id: "img-2",
            imageUrl: "https://s.example.com/a2.jpg",
            thumbnailUrl: "https://s.example.com/a2-thumb.jpg",
          },
        ]);

        const { removePublicFile } = await import("~/utils/storage.server");

        await bulkDeleteAudits({
          auditIds: ["a1", "a2"],
          organizationId: "org-1",
          userId: "user-1",
        });

        expect(removePublicFile).toHaveBeenCalledTimes(3);

        // Cleanup must happen after the $transaction has resolved — never
        // before, and never during a rollback.
        const txOrder = mockDb.$transaction.mock.invocationCallOrder[0];
        const firstStorageOrder =
          vi.mocked(removePublicFile).mock.invocationCallOrder[0];
        expect(txOrder).toBeLessThan(firstStorageOrder);
      });

      it("rolls back and skips storage cleanup when deleteMany count mismatches pre-read", async () => {
        // Three archived audits found in pre-read...
        mockDb.auditSession.findMany.mockResolvedValue([
          { id: "a1", status: AuditStatus.ARCHIVED },
          { id: "a2", status: AuditStatus.ARCHIVED },
          { id: "a3", status: AuditStatus.ARCHIVED },
        ]);
        // ...but by the time deleteMany runs, one slipped out of ARCHIVED.
        mockDb.auditSession.deleteMany.mockResolvedValue({ count: 2 });
        mockDb.auditImage.findMany.mockResolvedValue([
          {
            id: "img-1",
            imageUrl: "https://s.example.com/a1.jpg",
            thumbnailUrl: null,
          },
        ]);

        const { removePublicFile } = await import("~/utils/storage.server");

        await expect(
          bulkDeleteAudits({
            auditIds: ["a1", "a2", "a3"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringMatching(/status changed/),
        });

        // Transaction threw — no storage side-effect is allowed.
        expect(removePublicFile).not.toHaveBeenCalled();
      });

      it("wraps unknown causes in a 500 ShelfError", async () => {
        mockDb.auditSession.findMany.mockRejectedValue(new Error("boom"));

        await expect(
          bulkDeleteAudits({
            auditIds: ["a1"],
            organizationId: "org-1",
            userId: "user-1",
          })
        ).rejects.toMatchObject({
          status: 500,
          message: expect.stringMatching(/Failed to bulk delete audits/),
        });
      });
    });
  });
});
