/**
 * Renaming a non-registered member.
 *
 * The NRM scope is part of the write itself, so the rename can only land on a
 * row the NRM index lists: never a registered member's team record (its
 * `name` is the stored display name used for sorting and search), a member
 * with a pending invite, a soft-deleted NRM, or another workspace's member,
 * even if the row changed between the page load and the submit.
 *
 * @see {@link file://./service.server.ts} renameNrm, getNrmForEdit
 */
import { InviteStatuses } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** One `TeamMember` row, reduced to the fields the NRM scope reads. */
type Row = {
  id: string;
  organizationId: string;
  userId: string | null;
  deletedAt: Date | null;
  pendingInvite: boolean;
  name: string;
};

const rows = vi.hoisted(() => ({ list: [] as Row[] }));

/** Applies the NRM-scope predicate the way Postgres would, for these fields only. */
function matches(row: Row, where: Record<string, unknown>) {
  const invites = where.receivedInvites as
    | { none: { status: string } }
    | undefined;
  return (
    row.id === where.id &&
    row.organizationId === where.organizationId &&
    ("userId" in where ? row.userId === where.userId : true) &&
    ("deletedAt" in where ? row.deletedAt === where.deletedAt : true) &&
    (invites?.none.status === InviteStatuses.PENDING
      ? !row.pendingInvite
      : true)
  );
}

// why: the predicate the write is issued with IS the behaviour under test; an
// in-memory table that applies it shows which rows a write can reach
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: { name: string };
        }) => {
          const hit = rows.list.filter((r) => matches(r, where));
          hit.forEach((r) => {
            r.name = data.name;
          });
          return Promise.resolve({ count: hit.length });
        }
      ),
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const r = rows.list.find((row) => matches(row, where));
        return Promise.resolve(r ? { id: r.id, name: r.name } : null);
      }),
    },
  },
}));

const { renameNrm, getNrmForEdit } = await import(
  "~/modules/team-member/service.server"
);

const base: Row = {
  id: "",
  organizationId: "org-1",
  userId: null,
  deletedAt: null,
  pendingInvite: false,
  name: "Old",
};

beforeEach(() => {
  rows.list = [
    { ...base, id: "nrm" },
    { ...base, id: "registered", userId: "user-9" },
    { ...base, id: "invited", pendingInvite: true },
    { ...base, id: "deleted", deletedAt: new Date("2026-01-01") },
    { ...base, id: "foreign", organizationId: "org-2" },
  ];
});

describe("renameNrm", () => {
  it("renames a non-registered member of the workspace", async () => {
    await renameNrm({ nrmId: "nrm", organizationId: "org-1", name: "New" });
    expect(rows.list.find((r) => r.id === "nrm")?.name).toBe("New");
  });

  it.each(["registered", "invited", "deleted", "foreign"])(
    "refuses a %s member with 404 and leaves the row unchanged",
    async (id) => {
      await expect(
        renameNrm({ nrmId: id, organizationId: "org-1", name: "New" })
      ).rejects.toMatchObject({ status: 404 });
      expect(rows.list.find((r) => r.id === id)?.name).toBe("Old");
    }
  );
});

describe("getNrmForEdit", () => {
  it("loads a non-registered member", async () => {
    await expect(
      getNrmForEdit({ nrmId: "nrm", organizationId: "org-1" })
    ).resolves.toEqual({ id: "nrm", name: "Old" });
  });

  it.each(["registered", "invited", "deleted", "foreign"])(
    "404s a %s member",
    async (id) => {
      await expect(
        getNrmForEdit({ nrmId: id, organizationId: "org-1" })
      ).rejects.toMatchObject({ status: 404 });
    }
  );
});
