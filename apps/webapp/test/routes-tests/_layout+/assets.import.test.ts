// @vitest-environment node
/**
 * Asset import upload and confirm action.
 *
 * Pins the `preview` and `confirm` intents: the permission gate, the preview
 * payload, the redirect to the progress page, and that a draft from another
 * workspace is never confirmed. The real import service runs against a mocked
 * database so the workspace scoping is exercised, not assumed.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.import.tsx}
 * @see {@link file://./../../../app/modules/asset-import/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { buildContentImportPreview } from "~/modules/asset-import/preview.server";
import { action } from "~/routes/_layout+/assets.import";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: authorization is not under test; what it is called with and what it
// answers per case is.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: subscription limits are a separate concern from the import routes.
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanImportAssets: vi.fn(),
}));

// why: the route parses an uploaded file; rows are driven in directly.
vi.mock("~/utils/csv.server", () => ({ csvDataFromRequest: vi.fn() }));

// why: the preview reads the workspace and writes the draft; it has its own
// suite, here only how the route calls it matters.
vi.mock("~/modules/asset-import/preview.server", () => ({
  buildContentImportPreview: vi.fn(),
}));

// why: the import rows live in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

// why: the queue has its own tests; confirm only has to reach it.
vi.mock("~/modules/asset-import/worker.server", () => ({
  enqueueAssetImportStep: vi.fn(),
}));

// why: validation has its own suite.
vi.mock("~/modules/asset-import/validate.server", () => ({
  validateContentImportFile: vi.fn(),
}));

// why: the failure helper sends email over the network.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

type ActionResult = { init?: { status?: number }; data?: unknown };

/** Runs the action with a body and returns what it returned. */
async function run(body: BodyInit, headers?: HeadersInit) {
  return (await action(
    createActionArgs({
      request: new Request("http://localhost/assets/import", {
        method: "POST",
        body,
        headers,
      }),
      params: {},
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as unknown;
}

describe("assets.import action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...permissionContext({}),
      organizations: [],
      canUseBarcodes: true,
    } as never);
  });

  it("returns the preview for an uploaded file", async () => {
    const preview = { importId: "imp-1", totalRows: 1 };
    vi.mocked(csvDataFromRequest).mockResolvedValue([["title"], ["Drill"]]);
    vi.mocked(buildContentImportPreview).mockResolvedValue(preview as never);
    const form = new FormData();
    form.set("intent", "preview");
    form.set("file", new File(["title\nDrill"], "assets.csv"));

    const result = (await run(form)) as { intent: string; preview: unknown };

    expect(result).toMatchObject({ intent: "preview", preview });
    expect(buildContentImportPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "assets.csv",
        userId: "user-1",
        canUseBarcodes: true,
      })
    );
  });

  it("refuses an empty file", async () => {
    vi.mocked(csvDataFromRequest).mockResolvedValue([["title"]]);

    const result = (await run(
      new URLSearchParams({ intent: "preview" })
    )) as ActionResult;

    expect(result.init?.status).toBe(400);
    expect(buildContentImportPreview).not.toHaveBeenCalled();
  });

  it("queues a confirmed draft and redirects to its progress page", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({
        id: "imp-1",
        rows: [],
        canUseBarcodes: false,
        createdAt: new Date(),
      } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    const result = (await run(
      new URLSearchParams({ intent: "confirm", importId: "imp-1" })
    )) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/assets/import/imp-1");
  });

  it("404s on a draft that belongs to another workspace", async () => {
    // The draft lookup is scoped to the active workspace, so a foreign draft
    // is simply not found.
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = (await run(
      new URLSearchParams({ intent: "confirm", importId: "foreign" })
    )) as ActionResult;

    expect(result.init?.status).toBe(404);
    expect(db.assetImport.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        organizationId: "org-1",
        createdById: "user-1",
        status: "DRAFT",
      },
    });
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
  });

  it.each(["preview", "confirm"])(
    "403s %s without asset: import",
    async (intent) => {
      vi.mocked(requirePermission).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Forbidden",
          label: "Permission",
          status: 403,
          shouldBeCaptured: false,
        })
      );

      const result = (await run(
        new URLSearchParams({ intent, importId: "imp-1" })
      )) as ActionResult;

      expect(result.init?.status).toBe(403);
      expect(buildContentImportPreview).not.toHaveBeenCalled();
      expect(db.assetImport.updateMany).not.toHaveBeenCalled();
    }
  );
});
