import { AuditAssignmentRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { createAuditSession } from "./service.server";

vi.mock("~/database/db.server", () => {
  const mockDb = {
    auditSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    auditAsset: {
      createMany: vi.fn(),
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
  };
  auditAsset: {
    createMany: ReturnType<typeof vi.fn>;
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
    assigneeIds: ["user-2"],
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
          userId: "user-1",
          role: AuditAssignmentRole.LEAD,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "assignment-2",
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
    mockDb.auditAssignment.createMany.mockResolvedValue({ count: 2 });
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
      data: [
        {
          auditSessionId: "audit-1",
          userId: "user-1",
          role: AuditAssignmentRole.LEAD,
        },
        { auditSessionId: "audit-1", userId: "user-2", role: undefined },
      ],
    });

    expect(result.expectedAssets).toEqual([
      { id: "asset-1", name: "Camera A" },
      { id: "asset-2", name: "Camera B" },
    ]);
    expect(result.session.assignments).toHaveLength(2);
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
      assigneeIds: ["user-2", "user-2"],
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
      data: [
        {
          auditSessionId: "audit-1",
          userId: "user-1",
          role: AuditAssignmentRole.LEAD,
        },
        { auditSessionId: "audit-1", userId: "user-2", role: undefined },
      ],
    });
  });
});
