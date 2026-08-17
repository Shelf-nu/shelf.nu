/**
 * Tag bulk delete — "select all" scope
 *
 * When the user picks "select all" on a filtered list, the delete must
 * reproduce that list's filters. Ignoring them deletes every tag in the
 * workspace while the UI reports the filtered count — permanent data loss the
 * user was actively told would not happen.
 *
 * The filters are built by the same helper the list query uses, so the two
 * cannot drift. That drift is a real failure mode: the equivalent locations
 * helper matched on name only while its list matched name + description +
 * address, so "select all" silently missed rows the user could see.
 *
 * Regression coverage for detail.dev finding D088.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/api+/tags.bulk-actions.ts}
 */

import { TagUseFor } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ALL_SELECTED_KEY } from "~/utils/list";
import { bulkDeleteTags } from "./service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  tag: { deleteMany: vi.fn() },
}));

// why: asserting the exact where-clause sent to Prisma is the whole point —
// this bug is a wrong filter, not a wrong result
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const ORG = "org-1";

describe("bulkDeleteTags — explicit selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.tag.deleteMany.mockResolvedValue({ count: 2 });
  });

  it("deletes only the given ids, scoped to the organization", async () => {
    await bulkDeleteTags({
      tagIds: ["tag-1", "tag-2"],
      organizationId: ORG,
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tag-1", "tag-2"] }, organizationId: ORG },
    });
  });

  it("ignores currentSearchParams when ids are explicit", async () => {
    await bulkDeleteTags({
      tagIds: ["tag-1"],
      organizationId: ORG,
      currentSearchParams: "s=keep",
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tag-1"] }, organizationId: ORG },
    });
  });
});

describe("bulkDeleteTags — select all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.tag.deleteMany.mockResolvedValue({ count: 3 });
  });

  it("applies the search filter instead of deleting the whole workspace", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "s=fragile",
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        name: { contains: "fragile", mode: "insensitive" },
      },
    });
  });

  it("applies the useFor filter", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: `useFor=${TagUseFor.ASSET}`,
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        useFor: { has: TagUseFor.ASSET },
      },
    });
  });

  it("applies search and useFor together", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: `s=fragile&useFor=${TagUseFor.BOOKING}`,
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        name: { contains: "fragile", mode: "insensitive" },
        useFor: { has: TagUseFor.BOOKING },
      },
    });
  });

  it("deletes every tag in the org only when no filter is active", async () => {
    // Unfiltered select-all genuinely means everything — that is the one case
    // where the workspace-wide delete is correct.
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "",
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
  });

  it("ignores params that are not list filters", async () => {
    // Pagination and sorting ride along in the same query string and must not
    // widen or narrow what gets deleted.
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      currentSearchParams: "page=2&per_page=25&orderBy=createdAt",
    });

    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
  });
});
