/**
 * Deleting a single non-registered member.
 *
 * Deleting an NRM is a SOFT delete, so the row and every `Custody` pointing at
 * it survive the write. A member who still holds custody must therefore not be
 * deletable: the assets keep naming them as custodian while the member is gone
 * from every list and every custodian picker, leaving no way to find what they
 * hold except asset by asset.
 *
 * The rule lives in the write predicate rather than in a preceding read, so
 * that custody assigned between the two cannot slip past it, and the delete can
 * only ever reach a row the NRM index itself lists. Bulk delete and the
 * confirmation dialog apply the same rule, and all three must agree.
 *
 * @see {@link file://./service.server.ts} deleteNRM
 * @see {@link file://./bulk-delete-nrms.test.ts} the same rule on the bulk path
 */
import { InviteStatuses } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SELECTED_KEY } from "~/utils/list";

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
      id: NRM_ID,
      custodies: { none: {} },
      kitCustodies: { none: {} },
    });
  });

  it("treats the select-all sentinel as an ordinary id, not a wildcard", async () => {
    // `ALL_SELECTED_KEY` is how the bulk endpoints spell "every row matching
    // the current filters". Routing a single id through a helper that reads
    // that sentinel would drop the id filter entirely, turning one member's
    // delete into every custody-free NRM in the organization.
    await deleteNRM({ nrmId: ALL_SELECTED_KEY, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.id).toBe(ALL_SELECTED_KEY);
  });

  it("refuses a member who holds custody, and says so", async () => {
    // why: zero rows written is how the guarded statement reports that the
    // custody predicate excluded the member.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    // why: the member is still a listed NRM, which is what narrows the reason
    // for that miss down to custody.
    dbMocks.findFirst.mockResolvedValue({
      _count: { custodies: 3, kitCustodies: 0 },
    });

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toThrow(/custody/i);
  });

  it("treats a refused delete as a client error, not a server fault", async () => {
    // A 5xx here would page someone and burn Sentry's error quota over a user
    // being told to check in their assets first.
    // why: the smallest state that reaches the refusal — one row excluded by
    // the guard, holding one custody.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue({
      _count: { custodies: 1, kitCustodies: 0 },
    });

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toMatchObject({ status: 400, shouldBeCaptured: false });
  });

  it("refuses a kit-only custodian, who holds no asset custody at all", async () => {
    // Assigning a kit always writes `KitCustody`, and only writes the
    // inherited per-asset rows when the kit has assets — so the custodian of
    // an empty kit is invisible to a guard that counts `custodies` alone.
    // why: zero asset custody with kit custody present IS that member, and it
    // is a shape no database is needed to produce.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue({
      _count: { custodies: 0, kitCustodies: 2 },
    });

    await expect(
      deleteNRM({ nrmId: NRM_ID, organizationId: ORG })
    ).rejects.toThrow(/custody/i);
  });

  it("guards both custody shapes in the write predicate", async () => {
    await deleteNRM({ nrmId: NRM_ID, organizationId: ORG });

    const { where } = dbMocks.updateMany.mock.calls[0][0];
    expect(where.custodies).toEqual({ none: {} });
    expect(where.kitCustodies).toEqual({ none: {} });
  });

  it("does not blame custody that was released mid-delete", async () => {
    // The guarded write passed the row by, but by the time we look it holds
    // nothing: what blocked it was released between the two statements.
    // Reporting "release custody" would name something that is already gone.
    // why: the two responses disagree on purpose. Only stubbing them can put
    // the pair in a state a real database holds for microseconds.
    dbMocks.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.findFirst.mockResolvedValue({
      _count: { custodies: 0, kitCustodies: 0 },
    });

    const error = await deleteNRM({
      nrmId: NRM_ID,
      organizationId: ORG,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ status: 409, shouldBeCaptured: false });
    expect((error as Error).message).not.toMatch(/release custody/i);
  });

  it("reports an id that is not a deletable NRM as not found", async () => {
    // Nothing matched and nothing is there to match: the id belongs to another
    // organization, to a registered user, to a pending invite, or to a row
    // someone else already deleted.
    // why: a null diagnostic read stands in for all of those at once — the
    // scope predicate excludes them identically.
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
