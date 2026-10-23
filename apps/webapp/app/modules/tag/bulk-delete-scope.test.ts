/**
 * Tag bulk delete — "select all" scope
 *
 * When the user picks "select all" on a filtered list, the delete must
 * reproduce that list's filters. Ignoring them deletes every tag in the
 * workspace while the UI reports the filtered count — permanent data loss the
 * user was actively told would not happen.
 *
 * The filters are built by the same helper the list query uses, so the two
 * cannot drift. The matching ids are read first and the delete is scoped to
 * them, after the typed count is checked against how many matched. That drift is a real failure mode: the equivalent locations
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
  tag: { findMany: vi.fn(), deleteMany: vi.fn() },
}));

// why: asserting the exact where-clause sent to Prisma is the whole point —
// this bug is a wrong filter, not a wrong result
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const ORG = "org-1";

/** Rows the select-all read resolves to in these tests. */
const MATCHED = [{ id: "tag-a" }, { id: "tag-b" }, { id: "tag-c" }];

/** The read's where-clause, from the first `findMany` call. */
function readWhere() {
  return dbMock.tag.findMany.mock.calls[0][0].where;
}

describe("bulkDeleteTags — explicit selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.tag.findMany.mockResolvedValue([{ id: "tag-1" }, { id: "tag-2" }]);
    dbMock.tag.deleteMany.mockResolvedValue({ count: 2 });
  });

  it("deletes only the given ids, scoped to the organization", async () => {
    await bulkDeleteTags({
      tagIds: ["tag-1", "tag-2"],
      confirmation: "2",
      organizationId: ORG,
    });

    expect(readWhere()).toEqual({
      id: { in: ["tag-1", "tag-2"] },
      organizationId: ORG,
    });
    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tag-1", "tag-2"] }, organizationId: ORG },
    });
  });

  it("ignores currentSearchParams when ids are explicit", async () => {
    dbMock.tag.findMany.mockResolvedValue([{ id: "tag-1" }]);

    await bulkDeleteTags({
      tagIds: ["tag-1"],
      confirmation: "1",
      organizationId: ORG,
      currentSearchParams: "s=keep",
    });

    expect(readWhere()).toEqual({ id: { in: ["tag-1"] }, organizationId: ORG });
  });

  it("refuses when the typed count is not the number selected", async () => {
    await expect(
      bulkDeleteTags({
        tagIds: ["tag-1", "tag-2"],
        confirmation: "1",
        organizationId: ORG,
      })
    ).rejects.toMatchObject({
      status: 400,
      additionalData: { expectedConfirmation: 2 },
    });
    expect(dbMock.tag.deleteMany).not.toHaveBeenCalled();
  });
});

describe("bulkDeleteTags — select all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.tag.findMany.mockResolvedValue(MATCHED);
    dbMock.tag.deleteMany.mockResolvedValue({ count: MATCHED.length });
  });

  it("applies the search filter instead of deleting the whole workspace", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      confirmation: "3",
      organizationId: ORG,
      currentSearchParams: "s=fragile",
    });

    expect(readWhere()).toEqual({
      organizationId: ORG,
      name: { contains: "fragile", mode: "insensitive" },
    });
    // The write is the rows read, never the filter again.
    expect(dbMock.tag.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tag-a", "tag-b", "tag-c"] }, organizationId: ORG },
    });
  });

  it("applies the useFor filter", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      confirmation: "3",
      organizationId: ORG,
      currentSearchParams: `useFor=${TagUseFor.ASSET}`,
    });

    expect(readWhere()).toEqual({
      organizationId: ORG,
      useFor: { has: TagUseFor.ASSET },
    });
  });

  it("applies search and useFor together", async () => {
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      confirmation: "3",
      organizationId: ORG,
      currentSearchParams: `s=fragile&useFor=${TagUseFor.BOOKING}`,
    });

    expect(readWhere()).toEqual({
      organizationId: ORG,
      name: { contains: "fragile", mode: "insensitive" },
      useFor: { has: TagUseFor.BOOKING },
    });
  });

  it("reads every tag in the org only when no filter is active", async () => {
    // Unfiltered select-all genuinely means everything — that is the one case
    // where the workspace-wide read is correct.
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      confirmation: "3",
      organizationId: ORG,
      currentSearchParams: "",
    });

    expect(readWhere()).toEqual({ organizationId: ORG });
  });

  it("ignores params that are not list filters", async () => {
    // Pagination and sorting ride along in the same query string and must not
    // widen or narrow what gets deleted.
    await bulkDeleteTags({
      tagIds: [ALL_SELECTED_KEY],
      confirmation: "3",
      organizationId: ORG,
      currentSearchParams: "page=2&per_page=25&orderBy=createdAt",
    });

    expect(readWhere()).toEqual({ organizationId: ORG });
  });

  it("refuses a select-all without a typed count, deleting nothing", async () => {
    await expect(
      bulkDeleteTags({
        tagIds: [ALL_SELECTED_KEY],
        confirmation: undefined,
        organizationId: ORG,
        currentSearchParams: "s=fragile",
      })
    ).rejects.toMatchObject({
      status: 400,
      additionalData: { expectedConfirmation: 3 },
    });
    expect(dbMock.tag.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses when the list matches more than the user typed", async () => {
    // The dialog showed 2; a tag matching the search was added since.
    await expect(
      bulkDeleteTags({
        tagIds: [ALL_SELECTED_KEY],
        confirmation: "2",
        organizationId: ORG,
        currentSearchParams: "s=fragile",
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("matches 3 tags, not 2"),
    });
    expect(dbMock.tag.deleteMany).not.toHaveBeenCalled();
  });
});
