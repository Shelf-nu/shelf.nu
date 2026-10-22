// @vitest-environment node
/**
 * Asset import status endpoint.
 *
 * Pins the permission gate, the workspace scoping (a draft or another
 * workspace's import is a 404) and that the response carries the status
 * payload. The real service runs against a mocked database.
 *
 * @see {@link file://./../../../app/routes/api+/asset-imports.$importId.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { loader } from "~/routes/api+/asset-imports.$importId";
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

/** Calls the loader for `importId` as user-1. */
async function get(importId = "imp-1") {
  return (await loader(
    createLoaderArgs({
      request: new Request(`http://localhost/api/asset-imports/${importId}`),
      params: { importId },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as Result;
}

describe("GET /api/asset-imports/:importId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({}) as never
    );
  });

  it("returns the status of an import in the workspace", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      id: "imp-1",
      organizationId: "org-1",
      createdById: "user-1",
      status: "COMPLETED",
      phase: "FINALIZE",
      fileName: "assets.csv",
      totalRows: 3,
      processedRows: 3,
      errorMessage: null,
      warningCount: 0,
      completedAt: new Date("2026-10-14T10:00:00.000Z"),
      updatedAt: new Date(),
    } as never);

    const result = await get();

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.asset,
        action: PermissionAction.import,
      })
    );
    expect(result.data).toMatchObject({
      error: null,
      import: {
        id: "imp-1",
        status: "COMPLETED",
        completedAt: "2026-10-14T10:00:00.000Z",
        isMine: true,
      },
    });
  });

  it("404s on a draft or an import from another workspace", async () => {
    // The lookup excludes drafts and is scoped to the active workspace, so
    // both cases come back as no row.
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = await get("foreign");

    expect(result.init?.status).toBe(404);
    expect(db.assetImport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign",
          organizationId: "org-1",
          status: { not: "DRAFT" },
        },
      })
    );
  });

  it("403s without asset: import", async () => {
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
