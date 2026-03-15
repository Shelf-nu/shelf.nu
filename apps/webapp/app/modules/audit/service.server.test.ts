import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findMany,
  findUnique,
  create,
  createMany,
  deleteMany,
  remove as removeRecord,
} from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
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

// why: Mock note service to avoid database dependencies
vi.mock("~/modules/note/service.server", () => ({
  createAssetNotesForAuditAddition: vi.fn(),
  createAssetNotesForAuditRemoval: vi.fn(),
}));

// why: Stub the db export so imports resolve; actual queries go through query helpers
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: Auto-mock query helpers so we can control return values per test
vi.mock("~/database/query-helpers.server");

// why: Auto-mock sql helpers used for raw queries (increment/decrement counts)
vi.mock("~/database/sql.server");

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

    // Default: findMany for Asset table returns matched assets
    vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
      if (table === "Asset") {
        return Promise.resolve([
          { id: "asset-1", title: "Camera A" },
          { id: "asset-2", title: "Camera B" },
        ]);
      }
      if (table === "AuditAssignment") {
        return Promise.resolve([
          {
            id: "assignment-1",
            auditSessionId: "audit-1",
            userId: "user-2",
            role: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
      }
      if (table === "AuditAsset") {
        return Promise.resolve([
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
      }
      return Promise.resolve([]);
    });

    vi.mocked(create).mockResolvedValue({
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
    } as any);

    vi.mocked(findUnique).mockResolvedValue({
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
    } as any);

    vi.mocked(createMany).mockResolvedValue(undefined as any);
    vi.mocked(deleteMany).mockResolvedValue(undefined as any);
    vi.mocked(removeRecord).mockResolvedValue(undefined as any);
    vi.mocked(queryRaw).mockResolvedValue(undefined as any);
    vi.mocked(sql).mockImplementation(
      (strings: any, ...values: any[]) => ({ strings, values }) as any
    );
  });

  it("creates an audit session with expected assets and assignments", async () => {
    const result = await createAuditSession(defaultInput);

    expect(vi.mocked(findMany)).toHaveBeenCalledWith(
      expect.anything(), // db
      "Asset",
      {
        where: {
          id: { in: ["asset-1", "asset-2"] },
          organizationId: "org-1",
        },
        select: "id, title",
      }
    );

    expect(vi.mocked(create)).toHaveBeenCalledWith(
      expect.anything(),
      "AuditSession",
      expect.objectContaining({
        name: defaultInput.name,
        description: defaultInput.description,
        organizationId: defaultInput.organizationId,
        createdById: defaultInput.createdById,
        expectedAssetCount: 2,
        missingAssetCount: 2,
        scopeMeta: defaultInput.scopeMeta,
      })
    );

    expect(vi.mocked(createMany)).toHaveBeenCalledWith(
      expect.anything(),
      "AuditAsset",
      [
        { auditSessionId: "audit-1", assetId: "asset-1", expected: true },
        { auditSessionId: "audit-1", assetId: "asset-2", expected: true },
      ]
    );

    expect(vi.mocked(createMany)).toHaveBeenCalledWith(
      expect.anything(),
      "AuditAssignment",
      [{ auditSessionId: "audit-1", userId: "user-2" }]
    );

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
    vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
      if (table === "Asset") {
        return Promise.resolve([{ id: "asset-1", title: "Camera A" }]);
      }
      return Promise.resolve([]);
    });
    await expect(createAuditSession(defaultInput)).rejects.toBeInstanceOf(
      ShelfError
    );
  });

  it("deduplicates asset and assignee ids", async () => {
    vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
      if (table === "Asset") {
        return Promise.resolve([{ id: "asset-1", title: "Camera A" }]);
      }
      if (table === "AuditAssignment") {
        return Promise.resolve([
          {
            id: "assignment-1",
            auditSessionId: "audit-1",
            userId: "user-2",
            role: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
      }
      if (table === "AuditAsset") {
        return Promise.resolve([
          {
            id: "audit-asset-1",
            assetId: "asset-1",
            auditSessionId: "audit-1",
            expected: true,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await createAuditSession({
      ...defaultInput,
      assetIds: ["asset-1", "asset-1"],
    });

    expect(vi.mocked(findMany)).toHaveBeenCalledWith(
      expect.anything(),
      "Asset",
      {
        where: {
          id: { in: ["asset-1"] },
          organizationId: "org-1",
        },
        select: "id, title",
      }
    );

    expect(vi.mocked(createMany)).toHaveBeenCalledWith(
      expect.anything(),
      "AuditAsset",
      [{ auditSessionId: "audit-1", assetId: "asset-1", expected: true }]
    );

    expect(vi.mocked(createMany)).toHaveBeenCalledWith(
      expect.anything(),
      "AuditAssignment",
      [{ auditSessionId: "audit-1", userId: "user-2" }]
    );
  });

  describe("getPendingAuditsForOrganization", () => {
    it("returns pending audits for organization", async () => {
      const mockAudits = [
        {
          id: "audit-1",
          name: "Warehouse Audit Q1",
          createdAt: new Date("2025-01-15"),
          expectedAssetCount: 50,
          createdById: "user-john",
        },
        {
          id: "audit-2",
          name: "Office Audit",
          createdAt: new Date("2025-01-20"),
          expectedAssetCount: 25,
          createdById: "user-bob",
        },
      ];

      vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
        if (table === "AuditSession") {
          return Promise.resolve(mockAudits as any);
        }
        if (table === "User") {
          return Promise.resolve([
            {
              id: "user-john",
              firstName: "John",
              lastName: "Doe",
            },
            {
              id: "user-bob",
              firstName: "Bob",
              lastName: "Wilson",
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(queryRaw).mockResolvedValue([
        {
          auditSessionId: "audit-1",
          firstName: "Jane",
          lastName: "Smith",
        },
      ] as any);

      const result = await getPendingAuditsForOrganization({
        organizationId: "org-1",
      });

      expect(vi.mocked(findMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditSession",
        {
          where: {
            organizationId: "org-1",
            status: "PENDING",
          },
          select: "id, name, createdAt, expectedAssetCount, createdById",
          orderBy: { createdAt: "desc" },
        }
      );

      expect(result).toEqual([
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
      ]);
    });
  });

  describe("addAssetsToAudit", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(sql).mockImplementation(
        (strings: any, ...values: any[]) => ({ strings, values }) as any
      );
      vi.mocked(queryRaw).mockResolvedValue(undefined as any);
    });

    it("adds new assets to pending audit", async () => {
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      } as any);
      vi.mocked(findMany).mockResolvedValue([]);

      const result = await addAssetsToAudit({
        auditId: "audit-1",
        assetIds: ["asset-1", "asset-2"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(findUnique)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditSession",
        {
          where: { id: "audit-1", organizationId: "org-1" },
          select: "id, name, status",
        }
      );

      expect(vi.mocked(createMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditAsset",
        [
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
        ]
      );

      expect(vi.mocked(queryRaw)).toHaveBeenCalled();

      expect(result).toEqual({
        addedCount: 2,
        skippedCount: 0,
      });
    });

    it("filters out duplicate assets", async () => {
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      } as any);
      vi.mocked(findMany).mockResolvedValue([{ assetId: "asset-1" }] as any);

      const result = await addAssetsToAudit({
        auditId: "audit-1",
        assetIds: ["asset-1", "asset-2", "asset-3"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(createMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditAsset",
        [
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
        ]
      );

      expect(result).toEqual({
        addedCount: 2,
        skippedCount: 1,
      });
    });

    it("throws error when audit not found", async () => {
      vi.mocked(findUnique).mockResolvedValue(null as any);

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
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "COMPLETED",
      } as any);

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
      vi.mocked(sql).mockImplementation(
        (strings: any, ...values: any[]) => ({ strings, values }) as any
      );
      vi.mocked(queryRaw).mockResolvedValue(undefined as any);
      vi.mocked(removeRecord).mockResolvedValue(undefined as any);
    });

    it("removes expected asset from pending audit", async () => {
      // First findUnique call: AuditSession
      // Second findUnique call: AuditAsset
      vi.mocked(findUnique)
        .mockResolvedValueOnce({
          id: "audit-1",
          name: "Test Audit",
          status: "PENDING",
        } as any)
        .mockResolvedValueOnce({
          assetId: "asset-1",
          expected: true,
        } as any);

      await removeAssetFromAudit({
        auditId: "audit-1",
        auditAssetId: "audit-asset-1",
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(findUnique)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditSession",
        {
          where: { id: "audit-1", organizationId: "org-1" },
          select: "id, name, status",
        }
      );

      expect(vi.mocked(removeRecord)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditAsset",
        { id: "audit-asset-1" }
      );

      expect(vi.mocked(queryRaw)).toHaveBeenCalled();
    });

    it("removes unexpected asset without decrementing counts", async () => {
      vi.mocked(findUnique)
        .mockResolvedValueOnce({
          id: "audit-1",
          name: "Test Audit",
          status: "PENDING",
        } as any)
        .mockResolvedValueOnce({
          assetId: "asset-1",
          expected: false,
        } as any);

      await removeAssetFromAudit({
        auditId: "audit-1",
        auditAssetId: "audit-asset-1",
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(removeRecord)).toHaveBeenCalled();
      // queryRaw should NOT be called for unexpected assets (no count decrement)
      expect(vi.mocked(queryRaw)).not.toHaveBeenCalled();
    });

    it("throws error when audit not found", async () => {
      vi.mocked(findUnique).mockResolvedValue(null as any);

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
      vi.mocked(findUnique).mockResolvedValue({
        status: "ACTIVE",
      } as any);

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
      vi.mocked(findUnique)
        .mockResolvedValueOnce({
          status: "PENDING",
        } as any)
        .mockResolvedValueOnce(null as any);

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
      vi.mocked(sql).mockImplementation(
        (strings: any, ...values: any[]) => ({ strings, values }) as any
      );
      vi.mocked(queryRaw).mockResolvedValue(undefined as any);
      vi.mocked(deleteMany).mockResolvedValue(undefined as any);
    });

    it("removes multiple assets from pending audit", async () => {
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      } as any);
      vi.mocked(findMany).mockResolvedValue([
        { id: "audit-asset-1", assetId: "asset-1", expected: true },
        { id: "audit-asset-2", assetId: "asset-2", expected: true },
        { id: "audit-asset-3", assetId: "asset-3", expected: false },
      ] as any);

      const result = await removeAssetsFromAudit({
        auditId: "audit-1",
        auditAssetIds: ["audit-asset-1", "audit-asset-2", "audit-asset-3"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(deleteMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditAsset",
        { id: { in: ["audit-asset-1", "audit-asset-2", "audit-asset-3"] } }
      );

      expect(vi.mocked(queryRaw)).toHaveBeenCalled();

      expect(result).toEqual({ removedCount: 3 });
    });

    it("returns zero when no assets found", async () => {
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "PENDING",
      } as any);
      vi.mocked(findMany).mockResolvedValue([]);

      const result = await removeAssetsFromAudit({
        auditId: "audit-1",
        auditAssetIds: ["nonexistent-1", "nonexistent-2"],
        organizationId: "org-1",
        userId: "user-1",
      });

      expect(vi.mocked(deleteMany)).not.toHaveBeenCalled();
      expect(result).toEqual({ removedCount: 0 });
    });

    it("throws error when audit not found", async () => {
      vi.mocked(findUnique).mockResolvedValue(null as any);

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
      vi.mocked(findUnique).mockResolvedValue({
        id: "audit-1",
        name: "Test Audit",
        status: "COMPLETED",
      } as any);

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
