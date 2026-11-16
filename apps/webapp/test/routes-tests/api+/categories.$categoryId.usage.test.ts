/**
 * The usage endpoint behind the category delete dialog. The dialog reads
 * `data.usage` to decide whether to ask for the name, so this pins that the
 * route answers with exactly that shape, scoped to the caller's workspace.
 *
 * @see {@link file://../../../app/routes/api+/categories.$categoryId.usage.ts}
 * @see {@link file://../../../app/components/category/delete-category.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

const findFirst = vi.hoisted(() => vi.fn());

// why: the permission gate is not under test; it resolves the caller's org
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: no database in tests; the route reads one row's name and counts
vi.mock("~/database/db.server", () => ({
  db: { category: { findFirst } },
}));

const { loader } = await import("~/routes/api+/categories.$categoryId.usage");

/** Calls the loader for `id` and returns its status and body. */
async function load(id: string) {
  const result = (await loader(
    createLoaderArgs({
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      params: { categoryId: id },
      request: new Request(`http://localhost/api/categories/${id}/usage`),
    })
  )) as unknown as { data: unknown; init?: { status?: number } | null };
  return { status: result.init?.status ?? 200, body: result.data };
}

describe("GET /api/categories/:categoryId/usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers with the counts under `usage`, scoped to the workspace", async () => {
    findFirst.mockResolvedValue({
      name: "Cameras",
      _count: { assets: 3, kits: 1, customFields: 0, assetModelDefaults: 2 },
    });

    const { status, body } = await load("c1");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      usage: { assets: 3, kits: 1, customFields: 0, assetModelDefaults: 2 },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", organizationId: "org-1" },
      })
    );
  });

  it("answers 404 for a category that is not in the workspace", async () => {
    findFirst.mockResolvedValue(null);

    const { status, body } = await load("other-org");

    expect(status).toBe(404);
    expect(body).not.toHaveProperty("usage");
  });
});
