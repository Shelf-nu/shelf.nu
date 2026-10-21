// @vitest-environment node
/**
 * Active asset import endpoint.
 *
 * Pins the `asset: read` gate, that importers get the full status payload,
 * that members without import permission get only the progress fields, and
 * that the lookup is scoped to the active workspace. The real service runs
 * against a mocked database.
 *
 * @see {@link file://./../../../app/routes/api+/asset-imports.active.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { loader } from "~/routes/api+/asset-imports.active";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: authorization is not under test; what it is called with is.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the import rows live in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

// why: the service module imports the queue producer, which needs pg-boss.
vi.mock("~/modules/asset-import/worker.server", () => ({
  enqueueAssetImportStep: vi.fn(),
}));

// why: the service module imports the validator, which reads the workspace.
vi.mock("~/modules/asset-import/validate.server", () => ({
  validateContentImportFile: vi.fn(),
}));

// why: the failure helper sends email over the network.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

type Result = { init?: { status?: number }; data?: unknown };

/** A running import started by another member. */
const RUNNING_ROW = {
  id: "imp-1",
  organizationId: "org-1",
  createdById: "user-2",
  status: "RUNNING",
  phase: "ROWS",
  fileName: "assets.csv",
  totalRows: 3000,
  processedRows: 900,
  errorMessage: null,
  warningCount: 0,
  completedAt: null,
  // Fresh, so the stall check leaves it alone.
  updatedAt: new Date(),
};

/** Calls the loader as user-1. */
async function get() {
  return (await loader(
    createLoaderArgs({
      request: new Request("http://localhost/api/asset-imports/active"),
      params: {},
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as Result;
}

describe("GET /api/asset-imports/active", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({}) as never
    );
  });

  it("returns the full payload to a member who can import", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      ...RUNNING_ROW,
      updatedAt: new Date(),
    } as never);

    const result = await get();

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    );
    expect(result.data).toMatchObject({
      error: null,
      import: {
        id: "imp-1",
        status: "RUNNING",
        processedRows: 900,
        totalRows: 3000,
        isMine: false,
      },
    });
    expect(db.assetImport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1" }),
      })
    );
  });

  it("returns only the progress fields to a member who cannot import", async () => {
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.BASE] }) as never
    );
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      ...RUNNING_ROW,
      updatedAt: new Date(),
    } as never);

    const result = await get();

    expect((result.data as { import: unknown }).import).toEqual({
      status: "RUNNING",
      phase: "ROWS",
      processedRows: 900,
      totalRows: 3000,
    });
  });

  it("returns null when nothing is active", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = await get();

    expect(result.data).toMatchObject({ error: null, import: null });
  });

  it("403s without asset: read", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Forbidden",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const result = await get();

    expect(result.init?.status).toBe(403);
    expect(db.assetImport.findFirst).not.toHaveBeenCalled();
  });
});
