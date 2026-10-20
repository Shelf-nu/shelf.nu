/**
 * Category bulk delete: "select all" scope and the typed count.
 *
 * A "select all" on a searched categories list deletes only the categories
 * that search matches, read through the same builder the list uses. The ids
 * are read first and the delete is scoped to them, after the typed count is
 * checked against how many matched.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/api+/categories.bulk-actions.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { bulkDeleteCategories } from "./service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  category: { findMany: vi.fn(), deleteMany: vi.fn() },
}));

// why: the where-clauses sent to Prisma are the behaviour under test; a wrong
// filter here is permanent data loss, not a wrong result.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const ORG = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.category.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
  dbMock.category.deleteMany.mockResolvedValue({ count: 2 });
});

describe("bulkDeleteCategories", () => {
  it("scopes a select all to the list's search instead of the whole workspace", async () => {
    await bulkDeleteCategories({
      categoryIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "s=cam&page=3",
      confirmation: "2",
    });

    expect(dbMock.category.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        name: { contains: "cam", mode: "insensitive" },
      },
      select: { id: true },
    });
    expect(dbMock.category.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] }, organizationId: ORG },
    });
  });

  it("reads every category only when no search is active", async () => {
    await bulkDeleteCategories({
      categoryIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "",
      confirmation: "2",
    });

    expect(dbMock.category.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      select: { id: true },
    });
  });

  it("deletes explicit ids scoped to the organization", async () => {
    await bulkDeleteCategories({
      categoryIds: ["c1", "c2"],
      organizationId: ORG,
      confirmation: "2",
    });

    expect(dbMock.category.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1", "c2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("refuses a select all without the typed count, deleting nothing", async () => {
    await expect(
      bulkDeleteCategories({
        categoryIds: [ALL_SELECTED_KEY],
        organizationId: ORG,
        currentSearchParams: "s=cam",
        confirmation: undefined,
      })
    ).rejects.toMatchObject({
      status: 400,
      additionalData: { expectedConfirmation: 2 },
    });
    expect(dbMock.category.deleteMany).not.toHaveBeenCalled();
  });
});
