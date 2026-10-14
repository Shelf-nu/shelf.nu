// @vitest-environment node
/**
 * Asset import progress page: loader and `resume` action.
 *
 * Pins the permission gate and workspace scoping of both, and that resume only
 * acts on a FAILED import of the active workspace. The real service runs
 * against a mocked database.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.import.$importId.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { enqueueAssetImportStep } from "~/modules/asset-import/worker.server";
import { action, loader } from "~/routes/_layout+/assets.import.$importId";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: authorization is not under test; its answer is set per case.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the import rows live in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

// why: the queue has its own tests; resume only has to reach it.
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

const context = { getSession: () => ({ userId: "user-1" }) } as never;
const forbidden = () =>
  new ShelfError({
    cause: null,
    message: "Forbidden",
    label: "Permission",
    status: 403,
    shouldBeCaptured: false,
  });

/** Runs the resume action for `importId`. */
async function resume(importId = "imp-1") {
  return (await action(
    createActionArgs({
      request: new Request(`http://localhost/assets/import/${importId}`, {
        method: "POST",
        body: new URLSearchParams({ intent: "resume" }),
      }),
      params: { importId },
      context,
    })
  )) as { init?: { status?: number }; data?: unknown; success?: boolean };
}

/** Runs the loader for `importId`; it throws the error response. */
async function load(importId = "imp-1") {
  return loader(
    createLoaderArgs({
      request: new Request(`http://localhost/assets/import/${importId}`),
      params: { importId },
      context,
    })
  );
}

describe("assets.import.$importId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({}) as never
    );
  });

  describe("loader", () => {
    it("returns the status with the stored warnings", async () => {
      const warnings = [{ row: 2, title: "Drill", message: "QR in use" }];
      vi.mocked(db.assetImport.findFirst).mockResolvedValue({
        id: "imp-1",
        organizationId: "org-1",
        createdById: "user-1",
        status: "COMPLETED",
        phase: "FINALIZE",
        fileName: "assets.csv",
        totalRows: 1,
        processedRows: 1,
        errorMessage: null,
        warningCount: 1,
        completedAt: new Date("2026-10-14T10:00:00.000Z"),
        updatedAt: new Date(),
        warnings,
      } as never);

      const result = (await load()) as unknown as {
        header: { title: string };
        import: { warnings: unknown[] };
      };

      expect(result.header.title).toBe("Import progress");
      expect(result.import.warnings).toEqual(warnings);
    });

    it("404s on a draft or an import from another workspace", async () => {
      vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

      await expect(load("foreign")).rejects.toMatchObject({
        init: { status: 404 },
      });
    });

    it("403s without asset: import", async () => {
      vi.mocked(requirePermission).mockRejectedValue(forbidden());

      await expect(load()).rejects.toMatchObject({ init: { status: 403 } });
    });
  });

  describe("resume action", () => {
    it("queues a failed import of the workspace again", async () => {
      vi.mocked(db.assetImport.findFirst)
        .mockResolvedValueOnce({ id: "imp-1", errorMessage: "boom" } as never)
        .mockResolvedValueOnce(null);
      vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

      const result = await resume();

      expect(result).toMatchObject({ success: true });
      expect(enqueueAssetImportStep).toHaveBeenCalledWith({
        importId: "imp-1",
        step: "PREPARE",
      });
    });

    it("404s when the import is not FAILED in this workspace", async () => {
      // The lookup names status FAILED and the workspace, so a running,
      // completed, draft or foreign import is simply not found.
      vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

      const result = await resume("foreign");

      expect(result.init?.status).toBe(404);
      expect(db.assetImport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "foreign", organizationId: "org-1", status: "FAILED" },
        })
      );
      expect(enqueueAssetImportStep).not.toHaveBeenCalled();
    });

    it("403s without asset: import", async () => {
      vi.mocked(requirePermission).mockRejectedValue(forbidden());

      const result = await resume();

      expect(result.init?.status).toBe(403);
      expect(db.assetImport.findFirst).not.toHaveBeenCalled();
    });
  });
});
