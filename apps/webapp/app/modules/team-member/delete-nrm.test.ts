/**
 * Deleting a single non-registered member.
 *
 * Deleting an NRM is a SOFT delete, so the row and every `Custody` pointing at
 * it survive the write. A member who still holds custody must therefore not be
 * deletable: the assets keep naming them as custodian while the member is gone
 * from every list and every custodian picker, leaving no way to find what they
 * hold except asset by asset.
 *
 * The rule itself is not new — bulk delete and the confirmation dialog both
 * enforce it. These tests pin that the single delete enforces it too, in the
 * write predicate rather than in a preceding read, and that it can only ever
 * reach a row the NRM index actually lists.
 *
 * @see {@link file://./service.server.ts} deleteNRM
 * @see {@link file://./bulk-delete-nrms.test.ts} the same rule on the bulk path
 */
import { InviteStatuses } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

// why: the `where` the delete is issued with IS the behaviour under test — it
// is what makes the custody rule enforceable rather than advisory — so the
// tests assert on what Prisma receives instead of standing up a database.
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findFirst: dbMocks.findFirst,
      updateMany: dbMocks.updateMany,
    },
  },
}));

const { deleteNRM } = await import("~/modules/team-member/service.server");

const ORG = "org-1";
const NRM_ID = "nrm-1";

/** The predicates that make a TeamMember row an NRM the index lists. */
const NRM_BASE_SCOPE = {
  deletedAt: null,
  organizationId: ORG,
  userId: null,
  receivedInvites: { none: { status: InviteStatuses.PENDING } },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateMany.mockResolvedValue({ count: 1 });
  dbMocks.findFirst.mockResolvedValue(null);
});

describe("deleteNRM", () => {
  it("soft-deletes a member who holds no custody", async () => {
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    expect(dbMocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } })
    );
  });

  it("carries the custody rule in the write predicate", async () => {
    // The rule has to be part of the statement that writes. Checking custody
    // in a preceding read leaves a window: the list page is rendered, someone
    // else assigns custody, and the delete still lands on the stale answer.
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      ...NRM_BASE_SCOPE,
      id: { in: [NRM_ID] },
      custodies: { none: {} },
    });
  });

  it("refuses a member who holds custody, and says so", async () => {
    // No row matched the guarded write, and the member is still a listed NRM —
    // so custody is what held it back.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue({ _count: { custodies: 3 } });

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toThrow(/custody/i);
  });

  it("treats a refused delete as a client error, not a server fault", async () => {
    // A 5xx here would page someone and burn Sentry's error quota over a user
    // being told to check in their assets first.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue({ _count: { custodies: 1 } });

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toMatchObject({ status: 400, shouldBeCaptured: false });
  });

  it("reports an id that is not a deletable NRM as not found", async () => {
    // Nothing matched and nothing is there to match: the id belongs to another
    // organization, to a registered user, to a pending invite, or to a row
    // someone else already deleted.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue(null);

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toMatchObject({ status: 404, shouldBeCaptured: false });
  });

  it("cannot reach the row backing a registered user", async () => {
    // Those belong to the Users tab. Soft-deleting one there would strip the
    // custodian record out from under a member who still belongs to the
    // workspace, and the NRM index would never show it to put it back.
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.userId).toBeNull();
  });

  it("cannot reach a member whose invite is still pending", async () => {
    // Those are listed on the Invites tab, not here.
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.receivedInvites).toEqual({
      none: { status: InviteStatuses.PENDING },
    });
  });

  it("stays inside the caller's organization", async () => {
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.organizationId).toBe(ORG);
  });
});
