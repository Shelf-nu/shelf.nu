import { InviteStatuses } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";

const dbMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

// why: the scope of the delete query IS the behaviour under test, so we assert
// on the `where` Prisma receives rather than standing up a database.
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: { findMany: dbMocks.findMany, updateMany: dbMocks.updateMany },
  },
}));

const { bulkDeleteNRMs } = await import("~/modules/team-member/service.server");

const ORG = "org-1";

const NRM_BASE_SCOPE = {
  deletedAt: null,
  organizationId: ORG,
  userId: null,
  receivedInvites: { none: { status: InviteStatuses.PENDING } },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.findMany.mockResolvedValue([]);
  dbMocks.updateMany.mockResolvedValue({ count: 0 });
});

describe("bulkDeleteNRMs", () => {
  it("does not widen a select-all delete to every TeamMember in the org", async () => {
    await bulkDeleteNRMs({ nrmIds: [ALL_SELECTED_KEY], organizationId: ORG });

    // The regression: `{ organizationId }` alone would have soft-deleted the
    // rows backing registered users, which this index never lists.
    expect(dbMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: NRM_BASE_SCOPE })
    );
  });

  it("scopes a select-all delete to the active search", async () => {
    await bulkDeleteNRMs({
      nrmIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      search: "john",
    });

    const { where } = dbMocks.findMany.mock.calls[0][0];
    expect(where.OR).toHaveLength(3);
    expect(where.deletedAt).toBeNull();
  });

  it("refuses to act on explicitly-passed ids that are outside the NRM scope", async () => {
    await bulkDeleteNRMs({ nrmIds: ["a", "b"], organizationId: ORG });

    expect(dbMocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...NRM_BASE_SCOPE, id: { in: ["a", "b"] } },
      })
    );
  });

  it("soft-deletes only the rows the scoped query returned", async () => {
    dbMocks.findMany.mockResolvedValue([
      { id: "a", _count: { custodies: 0, kitCustodies: 0 } },
      { id: "b", _count: { custodies: 0, kitCustodies: 0 } },
    ]);

    await bulkDeleteNRMs({ nrmIds: [ALL_SELECTED_KEY], organizationId: ORG });

    expect(dbMocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["a", "b"] } }),
        data: { deletedAt: expect.any(Date) },
      })
    );
  });

  it("re-asserts the NRM scope and custody guard in the write predicate", async () => {
    dbMocks.findMany.mockResolvedValue([
      { id: "a", _count: { custodies: 0, kitCustodies: 0 } },
    ]);

    await bulkDeleteNRMs({ nrmIds: [ALL_SELECTED_KEY], organizationId: ORG });

    // The read and the write are two round trips. A row that stops being an
    // NRM in between — gains a custody, accepts an invite, is deleted by
    // someone else — must not be written by ids resolved before that change.
    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      ...NRM_BASE_SCOPE,
      id: { in: ["a"] },
      custodies: { none: {} },
      kitCustodies: { none: {} },
    });
  });

  it("refuses the batch for a kit-only custodian", async () => {
    // Assigning a kit always writes `KitCustody`; the inherited per-asset
    // rows only appear when the kit has assets. An empty kit's custodian
    // therefore holds nothing an asset-only count would see.
    dbMocks.findMany.mockResolvedValue([
      { id: "a", _count: { custodies: 0, kitCustodies: 1 } },
    ]);

    await expect(
      bulkDeleteNRMs({ nrmIds: ["a"], organizationId: ORG })
    ).rejects.toThrow(/custody/i);
    expect(dbMocks.updateMany).not.toHaveBeenCalled();
  });

  it("still refuses the batch when a selected member holds custody", async () => {
    dbMocks.findMany.mockResolvedValue([
      { id: "a", _count: { custodies: 2, kitCustodies: 0 } },
    ]);

    await expect(
      bulkDeleteNRMs({ nrmIds: ["a"], organizationId: ORG })
    ).rejects.toThrow(/custody/i);
    expect(dbMocks.updateMany).not.toHaveBeenCalled();
  });
});
