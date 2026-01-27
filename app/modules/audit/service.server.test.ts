import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  createAuditSession,
  addAssetsToAudit,
  removeAssetFromAudit,
  removeAssetsFromAudit,
  getPendingAuditsForOrganization,
} from "./service.server";

// why: Mock the helper functions that create automatic notes to avoid database dependencies in unit tests
vi.mock("./helpers.server", () => ({
  createAuditCreationNote: vi.fn(),
  createAssetScanNote: vi.fn(),
  createAssetsAddedToAuditNote: vi.fn(),
  createAssetRemovedFromAuditNote: vi.fn(),
  createAssetsRemovedFromAuditNote: vi.fn(),
}));

vi.mock("~/database/db.server", () => {
  const mockDb = {
    auditSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditNote: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
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
            },
          },
          assignments: {
            select: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
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
});
