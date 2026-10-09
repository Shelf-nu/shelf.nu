/**
 * Deleting a category or a tag asks for its name only while something uses
 * it, the server half of `DeleteCategory` and `DeleteTag`. A used one refuses
 * a request that did not type the name; an unused one deletes with one click.
 *
 * @see {@link file://../../../app/routes/_layout+/categories.tsx}
 * @see {@link file://../../../app/routes/_layout+/tags.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

const mocks = vi.hoisted(() => ({
  findCategory: vi.fn(),
  findTag: vi.fn(),
  deleteCategory: vi.fn(),
  deleteTag: vi.fn(),
}));

// why: the permission gate is not under test; it lets the delete through
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: no database in tests; each delete reads only the name and usage counts
vi.mock("~/database/db.server", () => ({
  db: {
    category: { findFirst: mocks.findCategory },
    tag: { findFirst: mocks.findTag },
  },
}));

// why: the deletes themselves are covered by the service tests; here only
// whether the route calls them is observed
vi.mock("~/modules/category/service.server", () => ({
  deleteCategory: mocks.deleteCategory,
}));
vi.mock("~/modules/tag/service.server", () => ({
  deleteTag: mocks.deleteTag,
}));

// why: the success toast goes through an SSE emitter that is not set up here
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const { action: categoryAction } = await import("~/routes/_layout+/categories");
const { action: tagAction } = await import("~/routes/_layout+/tags");

/**
 * Posts a delete for `id` with `fields` to `action`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
async function submitDelete(
  action: typeof categoryAction | typeof tagAction,
  fields: Record<string, string>
) {
  const result = await action(
    createActionArgs({
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/x", {
        method: "DELETE",
        body: new URLSearchParams({ id: "item-1", ...fields }),
      }),
    })
  );
  const r = result as unknown as { init?: { status?: number } | null };
  return r.init?.status ?? 200;
}

const unusedCategory = {
  name: "Cameras",
  _count: { assets: 0, kits: 0, customFields: 0, assetModelDefaults: 0 },
};

describe("category delete: typed name only while in use", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a category used by an asset when the name is missing", async () => {
    mocks.findCategory.mockResolvedValue({
      ...unusedCategory,
      _count: { ...unusedCategory._count, assets: 3 },
    });

    expect(await submitDelete(categoryAction, {})).toBe(400);
    expect(mocks.deleteCategory).not.toHaveBeenCalled();
  });

  it("counts a custom field scoped to the category as use", async () => {
    mocks.findCategory.mockResolvedValue({
      ...unusedCategory,
      _count: { ...unusedCategory._count, customFields: 1 },
    });

    expect(await submitDelete(categoryAction, {})).toBe(400);
  });

  it("deletes a used category when its name is typed", async () => {
    mocks.findCategory.mockResolvedValue({
      ...unusedCategory,
      _count: { ...unusedCategory._count, kits: 1 },
    });

    await submitDelete(categoryAction, { confirmation: "cameras" });
    expect(mocks.deleteCategory).toHaveBeenCalledWith({
      id: "item-1",
      organizationId: "org-1",
    });
  });

  it("deletes an unused category with one click", async () => {
    mocks.findCategory.mockResolvedValue(unusedCategory);

    await submitDelete(categoryAction, {});
    expect(mocks.deleteCategory).toHaveBeenCalledTimes(1);
  });
});

describe("tag delete: typed name only while in use", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a tag on a booking when the name is missing", async () => {
    mocks.findTag.mockResolvedValue({
      name: "Fragile",
      _count: { assets: 0, bookings: 1 },
    });

    expect(await submitDelete(tagAction, {})).toBe(400);
    expect(mocks.deleteTag).not.toHaveBeenCalled();
  });

  it("deletes a used tag when its name is typed", async () => {
    mocks.findTag.mockResolvedValue({
      name: "Fragile",
      _count: { assets: 2, bookings: 0 },
    });

    await submitDelete(tagAction, { confirmation: "FRAGILE" });
    expect(mocks.deleteTag).toHaveBeenCalledTimes(1);
  });

  it("deletes an unused tag with one click", async () => {
    mocks.findTag.mockResolvedValue({
      name: "Old",
      _count: { assets: 0, bookings: 0 },
    });

    await submitDelete(tagAction, {});
    expect(mocks.deleteTag).toHaveBeenCalledTimes(1);
  });
});
