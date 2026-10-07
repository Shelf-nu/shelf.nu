/**
 * Account deletion takes the membership lock before any entity write and
 * revokes inside its own transaction, the order every role-change path uses.
 *
 * @see {@link file://./service.server.ts} softDeleteUser, lockMembership
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment node

// why: the deletion reads and writes memberships, entity owners and the user
// row; an in-memory client records the order of those calls without Postgres
vi.mock("~/database/db.server", () => {
  const updateMany = () => ({
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  const db = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        profilePicture: null,
        contact: null,
        userOrganizations: [
          {
            organizationId: "org-1",
            roles: ["ADMIN"],
            organization: { id: "org-1", userId: "owner-1" },
          },
        ],
      }),
      update: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
    userOrganization: {
      findUnique: vi.fn().mockResolvedValue({ roles: ["ADMIN"] }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    teamMember: { findMany: vi.fn().mockResolvedValue([{ id: "tm-1" }]) },
    userContact: { delete: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "uo-1" }]),
    asset: updateMany(),
    category: updateMany(),
    tag: updateMany(),
    location: updateMany(),
    customField: updateMany(),
    invite: updateMany(),
    booking: updateMany(),
    image: updateMany(),
    kit: updateMany(),
    assetReminder: updateMany(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) =>
    cb(db)
  );
  return { db };
});

// why: deleting the profile picture calls Supabase storage, outside the
// transaction under test
vi.mock("~/utils/storage.server", () => ({ deleteProfilePicture: vi.fn() }));

// why: the auth account is deleted in Supabase after the transaction commits
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { deleteUser: vi.fn().mockResolvedValue({ error: null }) } },
  }),
}));

// why: the confirmation email is a side effect after the transaction
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

const { db } = await import("~/database/db.server");
const { lockMembership, softDeleteUser } = await import("./service.server");

describe("softDeleteUser lock order", () => {
  beforeEach(() => vi.clearAllMocks());

  it("locks the membership before transferring entities, and revokes in the same transaction", async () => {
    await softDeleteUser("user-1");

    const firstLock = vi.mocked(db.$queryRaw).mock.invocationCallOrder[0];
    const firstEntityWrite = vi.mocked(db.asset.updateMany).mock
      .invocationCallOrder[0];
    const revoke = vi.mocked(db.userOrganization.deleteMany).mock
      .invocationCallOrder[0];
    expect(firstLock).toBeLessThan(firstEntityWrite);
    expect(firstEntityWrite).toBeLessThan(revoke);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("locks every membership, in workspace order, before the first write", async () => {
    vi.mocked(db.user.findUniqueOrThrow).mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      profilePicture: null,
      contact: null,
      userOrganizations: [
        {
          organizationId: "org-b",
          roles: ["ADMIN"],
          organization: { id: "org-b", userId: "owner-b" },
        },
        {
          organizationId: "org-a",
          roles: ["BASE"],
          organization: { id: "org-a", userId: "owner-a" },
        },
      ],
    } as never);

    await softDeleteUser("user-1");

    const lockCalls = vi.mocked(db.$queryRaw).mock;
    // Tagged-template call: [strings, userId, organizationId].
    const lockedOrgs = lockCalls.calls.slice(0, 2).map((call) => call[2]);
    expect(lockedOrgs).toEqual(["org-a", "org-b"]);
    const firstWrite = Math.min(
      ...vi.mocked(db.asset.updateMany).mock.invocationCallOrder,
      ...vi.mocked(db.user.update).mock.invocationCallOrder
    );
    expect(lockCalls.invocationCallOrder[1]).toBeLessThan(firstWrite);
  });

  it("aborts when the member became the workspace owner, with nothing transferred", async () => {
    vi.mocked(db.userOrganization.findUnique).mockResolvedValueOnce({
      roles: ["OWNER"],
    } as never);

    await expect(softDeleteUser("user-1")).rejects.toMatchObject({
      status: 400,
    });
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.userOrganization.deleteMany).not.toHaveBeenCalled();
  });
});

describe("lockMembership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes a row lock on the membership, then re-reads it on the same client", async () => {
    const result = await lockMembership(db as never, {
      userId: "user-1",
      organizationId: "org-1",
    });

    const sql = vi.mocked(db.$queryRaw).mock.calls[0][0] as unknown as string[];
    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(sql.join("?")).toContain('"UserOrganization"');
    expect(vi.mocked(db.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(db.userOrganization.findUnique).mock.invocationCallOrder[0]
    );
    expect(db.userOrganization.findUnique).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: "user-1", organizationId: "org-1" },
      },
      select: { roles: true },
    });
    expect(result).toEqual({ roles: ["ADMIN"] });
  });
});
