// @vitest-environment node
/**
 * Asset import preview rows endpoint.
 *
 * Pins the permission gate, the draft scoping (only the uploader's DRAFT in
 * the active workspace), the offset validation and the `{ rows, nextOffset }`
 * payload the preview stage's "Load more" reads. The real service runs
 * against a mocked database.
 *
 * @see {@link file://./../../../app/routes/api+/asset-imports.$importId.preview-rows.ts}
 * @see {@link file://./../../../app/components/assets/import-content/preview-stage.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { findMissingImportEntities } from "~/modules/asset-import/missing-entities.server";
import { loader } from "~/routes/api+/asset-imports.$importId.preview-rows";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: authorization is not under test; what it is called with is.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the draft rows live in the database.
vi.mock("~/database/db.server", () => ({
  db: { assetImport: { findFirst: vi.fn() } },
}));

// why: the lookup reads the workspace's entities and has its own tests.
vi.mock("~/modules/asset-import/missing-entities.server", () => ({
  findMissingImportEntities: vi.fn(),
}));

// why: the preview module imports the validator, which reads the workspace.
vi.mock("~/modules/asset-import/validate.server", () => ({
  validateContentImportFile: vi.fn(),
}));

type Result = { init?: { status?: number }; data?: unknown };

/** Calls the loader as user-1 with the raw `query` string. */
async function get(query = "offset=100", importId = "imp-1") {
  return (await loader(
    createLoaderArgs({
      request: new Request(
        `http://localhost/api/asset-imports/${importId}/preview-rows?${query}`
      ),
      params: { importId },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as Result;
}

/** `count` stored rows, numbered from spreadsheet row 2. */
function storedRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: `k${index}`,
    assetId: `a${index}`,
    rowNumber: index + 2,
    title: `Asset ${index}`,
    category: index === 100 ? "Fresh" : "Tools",
  }));
}

describe("GET /api/asset-imports/:importId/preview-rows", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({}) as never
    );
    vi.mocked(findMissingImportEntities).mockResolvedValue({
      categories: ["Fresh"],
      locations: [],
      tags: [],
      kits: [],
      custodians: [],
      customFields: [],
      assetModels: [],
    });
  });

  it("returns the next page of grid rows of the viewer's draft", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      rows: storedRows(250),
    } as never);

    const result = await get("offset=100");

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.asset,
        action: PermissionAction.import,
      })
    );
    expect(db.assetImport.findFirst).toHaveBeenCalledWith({
      where: {
        id: "imp-1",
        organizationId: "org-1",
        createdById: "user-1",
        status: "DRAFT",
      },
      select: { rows: true },
    });
    const page = result.data as {
      error: null;
      rows: { key: string; label: string; cells: Record<string, unknown> }[];
      nextOffset: number | null;
    };
    expect(page.error).toBeNull();
    expect(page.nextOffset).toBe(200);
    expect(page.rows).toHaveLength(100);
    expect(page.rows[0]).toEqual({
      key: "k100",
      label: "102",
      cells: {
        title: { value: "Asset 100", tone: "plain" },
        category: { value: "Fresh", tone: "new", note: "Will be created" },
      },
    });
  });

  it("returns a null next offset on the last page", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue({
      rows: storedRows(250),
    } as never);

    const result = await get("offset=200");

    expect(result.data).toMatchObject({ nextOffset: null });
    expect((result.data as { rows: unknown[] }).rows).toHaveLength(50);
  });

  it("404s when the draft is not the viewer's or is no longer a draft", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = await get();

    expect(result.init?.status).toBe(404);
  });

  it.each(["", "offset=", "offset=-1", "offset=1.5", "offset=abc"])(
    "400s on an invalid offset (%j)",
    async (query) => {
      const result = await get(query);

      expect(result.init?.status).toBe(400);
      expect(db.assetImport.findFirst).not.toHaveBeenCalled();
    }
  );

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
