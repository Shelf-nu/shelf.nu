/**
 * The usage endpoint behind the tag delete dialog. The dialog reads
 * `data.usage` to decide whether to ask for the name, so this pins that the
 * route answers with exactly that shape, scoped to the caller's workspace.
 *
 * @see {@link file://../../../app/routes/api+/tags.$tagId.usage.ts}
 * @see {@link file://../../../app/components/tag/delete-tag.tsx}
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
  db: { tag: { findFirst } },
}));

const { loader } = await import("~/routes/api+/tags.$tagId.usage");

/** Calls the loader for `id` and returns its status and body. */
async function load(id: string) {
  const result = (await loader(
    createLoaderArgs({
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      params: { tagId: id },
      request: new Request(`http://localhost/api/tags/${id}/usage`),
    })
  )) as unknown as { data: unknown; init?: { status?: number } | null };
  return { status: result.init?.status ?? 200, body: result.data };
}

describe("GET /api/tags/:tagId/usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers with the counts under `usage`, scoped to the workspace", async () => {
    findFirst.mockResolvedValue({
      name: "Fragile",
      _count: { assets: 0, bookings: 4 },
    });

    const { status, body } = await load("t1");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      usage: { assets: 0, bookings: 4 },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1", organizationId: "org-1" },
      })
    );
  });

  it("answers 404 for a tag that is not in the workspace", async () => {
    findFirst.mockResolvedValue(null);

    const { status, body } = await load("other-org");

    expect(status).toBe(404);
    expect(body).not.toHaveProperty("usage");
  });
});
