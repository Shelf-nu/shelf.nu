/**
 * revokeAccessToOrganization — owner protection
 *
 * A workspace must always have an owner, and revoking is a one-way door: it
 * deletes the target's `UserOrganization` row, which is exactly the record
 * `transferOwnership` looks up to hand ownership on. Revoke the owner and the
 * workspace cannot be recovered through the UI — `Organization.userId` still
 * names them, but with no membership they get a 403 and every transfer path
 * fails.
 *
 * The rule is enforced by a conditional DELETE rather than a preceding read,
 * because a check-then-delete loses to an ownership transfer committing in
 * between. The preceding read survives only to produce a friendly message in
 * the common case.
 *
 * Regression coverage for detail.dev finding D058.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./utils.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeAccessToOrganization } from "./service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => {
  const client = {
    userOrganization: { findFirst: vi.fn(), deleteMany: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    user: { update: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  return client;
});

// why: isolating the guard from the database; the assertion is that the
// destructive write never happens
vi.mock("~/database/db.server", () => ({ db: dbMock }));

describe("revokeAccessToOrganization — owner protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // The transaction callback runs against the same mock client
    dbMock.$transaction.mockImplementation(
      (callback: (tx: unknown) => unknown) => callback(dbMock)
    );
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm-1" });
    dbMock.user.update.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    });
    dbMock.$executeRaw.mockResolvedValue(0);
    dbMock.userOrganization.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("refuses to revoke the workspace owner", async () => {
    dbMock.userOrganization.findFirst.mockResolvedValue({
      roles: [OrganizationRoles.OWNER],
    });

    await expect(
      revokeAccessToOrganization({
        userId: "owner-user",
        organizationId: "org-1",
      })
    ).rejects.toThrow(/transfer ownership/i);

    // The delete is the irreversible step — it must not run at all
    expect(dbMock.userOrganization.deleteMany).not.toHaveBeenCalled();
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("scopes the delete so an owner can never match it", async () => {
    dbMock.userOrganization.findFirst.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    });

    await revokeAccessToOrganization({
      userId: "admin-user",
      organizationId: "org-1",
    });

    // The role condition must be part of the DELETE, not a preceding read —
    // that is what makes this safe against a concurrent ownership transfer.
    expect(dbMock.userOrganization.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "admin-user",
        organizationId: "org-1",
        NOT: { roles: { has: OrganizationRoles.OWNER } },
      },
    });
  });

  it("refuses when the target became the owner after the initial read", async () => {
    // The race: the read sees ADMIN, an ownership transfer commits, and the
    // conditional delete then matches nothing because they are now OWNER.
    dbMock.userOrganization.findFirst
      .mockResolvedValueOnce({ roles: [OrganizationRoles.ADMIN] })
      .mockResolvedValueOnce({ roles: [OrganizationRoles.OWNER] });
    dbMock.userOrganization.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      revokeAccessToOrganization({
        userId: "promoted-user",
        organizationId: "org-1",
      })
    ).rejects.toThrow(/transfer ownership/i);

    // A zero-row delete must not pass silently — that is the one regression
    // this conditional-delete refactor could introduce.
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("still revokes a non-owner", async () => {
    dbMock.userOrganization.findFirst.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    });

    await revokeAccessToOrganization({
      userId: "admin-user",
      organizationId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalled();
  });

  it("still revokes a user whose membership row is missing", async () => {
    // Defensive: a missing row must not become a silent block on revocation
    dbMock.userOrganization.findFirst.mockResolvedValue(null);
    dbMock.userOrganization.deleteMany.mockResolvedValue({ count: 0 });

    await revokeAccessToOrganization({
      userId: "ghost-user",
      organizationId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalled();
  });
});
