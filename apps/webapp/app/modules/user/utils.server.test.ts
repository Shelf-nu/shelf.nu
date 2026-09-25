/**
 * User Action Resolver: role guards
 *
 * Pinned here:
 *
 * 1. The "resend invite" path cannot mint an OWNER invite. The handler takes a
 *    free-text `userFriendlyRole` and maps it back through `labelToRole`, which
 *    knows the Owner label, so the invitable check is what refuses it.
 *
 * 2. Resending an Administrator invite needs the workspace owner, and a refused
 *    resend leaves the existing invite pending.
 *
 * 3. The "revoke access" path respects the same rule `changeUserRole`
 *    enforces: only the workspace owner may act on a member whose effective
 *    role is Administrator. Revoking is the stronger action, so it can never
 *    be the looser one.
 *
 * 4. A role change takes the target's membership lock first, reads the
 *    member's effective role under it, and validates the transfer recipient
 *    before writing the role or the role-change log, all in one transaction.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../invite/roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { createInvite } from "~/modules/invite/service.server";
import { ShelfError } from "~/utils/error";
import {
  changeUserRole,
  lockMembership,
  revokeAccessToOrganization,
  transferOnRoleChange,
} from "./service.server";
import { resolveUserAction } from "./utils.server";

// @vitest-environment node

// why: the resend path writes invites and sends email
vi.mock("../invite/service.server", () => ({ createInvite: vi.fn() }));

// why: revocation deletes rows and sends email; the guard under test must stop
// it before that happens. The role change's lock, transfer and role write are
// service functions with their own suites; here only their order and inputs
// are under test
vi.mock("./service.server", () => ({
  revokeAccessToOrganization: vi.fn(),
  changeUserRole: vi.fn(),
  lockMembership: vi.fn(),
  transferOnRoleChange: vi.fn(),
}));

// why: resend invalidates prior invites for the same invitee first; a role
// change reads the workspace owner (the default recipient), writes the
// role-change log inside a transaction and reads the member's email for the
// notice. The transaction runs its callback against the same stub.
vi.mock("~/database/db.server", () => {
  const db = {
    invite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userOrganization: { findFirst: vi.fn() },
    organization: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        name: "Org",
        customEmailFooter: null,
        userId: "owner-user",
      }),
    },
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "t@example.com" }),
    },
    roleChangeLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) =>
    cb(db)
  );
  return { db };
});

// why: rendering the email is outside the role-change contract
vi.mock("~/emails/role-change-template", () => ({
  roleChangeTemplateString: vi.fn().mockResolvedValue(""),
}));

// why: success notifications are a side effect, not part of the contract
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: avoids a real mail transport
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

/** Builds the resend POST an attacker would hand-craft */
function resendRequest(userFriendlyRole: string) {
  const body = new URLSearchParams({
    intent: "resend",
    email: "invitee@example.com",
    name: "Invitee",
    teamMemberId: "tm-1",
    userFriendlyRole,
  });

  return new Request("http://localhost/settings/team/invites", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("resolveUserAction — resend invite role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only the fact that it resolved matters here; the assertions are on the
    // arguments createInvite was called with, not on its return value.
    vi.mocked(createInvite).mockResolvedValue({ id: "invite-1" } as Awaited<
      ReturnType<typeof createInvite>
    >);
  });

  it("refuses to resend an invite as Owner", async () => {
    await expect(
      resolveUserAction(
        resendRequest("Owner"),
        "org-1",
        "admin-user",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toThrow(/invalid role/i);

    // The invite must never be created — that write is the escalation
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN resending an Administrator invite, before invalidating anything", async () => {
    await expect(
      resolveUserAction(
        resendRequest("Administrator"),
        "org-1",
        "admin-user",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toMatchObject({ status: 403 });

    // A rejected resend must leave the existing invite pending
    expect(db.invite.updateMany).not.toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("lets the OWNER resend an Administrator invite", async () => {
    await resolveUserAction(
      resendRequest("Administrator"),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    expect(db.invite.updateMany).toHaveBeenCalledTimes(1);
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: [OrganizationRoles.ADMIN],
        actorOwnsWorkspace: true,
      })
    );
  });

  it("lets an ADMIN resend a Self service invite", async () => {
    await resolveUserAction(
      resendRequest("Self service"),
      "org-1",
      "admin-user",
      accessFor([OrganizationRoles.ADMIN])
    );

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: [OrganizationRoles.SELF_SERVICE],
        actorOwnsWorkspace: false,
      })
    );
  });
});

/** Builds the revoke-access POST an attacker would hand-craft */
function revokeRequest(targetUserId: string) {
  const body = new URLSearchParams({
    intent: "revokeAccess",
    userId: targetUserId,
  });

  return new Request("http://localhost/settings/team/users", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

const userOrgMock = vi.mocked(db.userOrganization.findFirst);

describe("resolveUserAction — revoke access role hierarchy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(revokeAccessToOrganization).mockResolvedValue({
      email: "target@example.com",
    } as Awaited<ReturnType<typeof revokeAccessToOrganization>>);
  });

  it("refuses an ADMIN revoking another ADMIN's access", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    } as never);

    await expect(
      resolveUserAction(
        revokeRequest("other-admin"),
        "org-1",
        "admin-user",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toThrow(/only the workspace owner/i);

    expect(revokeAccessToOrganization).not.toHaveBeenCalled();
  });

  it("lets the OWNER revoke an ADMIN's access", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    } as never);

    await resolveUserAction(
      revokeRequest("some-admin"),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    expect(revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "some-admin",
      organizationId: "org-1",
      actorOwnsWorkspace: true,
    });
  });

  it("refuses an ADMIN revoking a member stored as [SELF_SERVICE, ADMIN]", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
    } as never);

    await expect(
      resolveUserAction(
        revokeRequest("mixed-admin"),
        "org-1",
        "admin-user",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toThrow(/only the workspace owner/i);
    expect(revokeAccessToOrganization).not.toHaveBeenCalled();
  });

  it("lets a caller stored as [ADMIN, OWNER] revoke an ADMIN's access", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    } as never);

    await resolveUserAction(
      revokeRequest("some-admin"),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])
    );

    expect(revokeAccessToOrganization).toHaveBeenCalledTimes(1);
  });

  it("still lets an ADMIN revoke a BASE user's access", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.BASE],
    } as never);

    await resolveUserAction(
      revokeRequest("base-user"),
      "org-1",
      "admin-user",
      accessFor([OrganizationRoles.ADMIN])
    );

    expect(revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "base-user",
      organizationId: "org-1",
      actorOwnsWorkspace: false,
    });
  });
});

/** Builds the change-role POST the dialog submits */
function changeRoleRequest(fields: Record<string, string>) {
  return new Request("http://localhost/settings/team/users", {
    method: "POST",
    body: new URLSearchParams({ intent: "changeRole", ...fields }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

/** The target's membership as the locked re-read returns it */
function lockedMembership(roles: OrganizationRoles[] | null) {
  vi.mocked(lockMembership).mockResolvedValue(roles ? { roles } : null);
}

describe("resolveUserAction: change role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transferOnRoleChange).mockResolvedValue({
      ownership: true,
      bookingsCreatedForOthers: true,
    });
  });

  it("changes nothing when the transfer recipient is refused", async () => {
    lockedMembership([OrganizationRoles.ADMIN]);
    vi.mocked(transferOnRoleChange).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "bad recipient",
        label: "Team",
        status: 400,
      })
    );

    await expect(
      resolveUserAction(
        changeRoleRequest({
          userId: "target",
          role: "BASE",
          transferToUserId: "target",
        }),
        "org-1",
        "owner-user",
        accessFor([OrganizationRoles.OWNER])
      )
    ).rejects.toMatchObject({ status: 400 });

    // The role write ran in the same transaction; the refusal rolls it back.
    expect(db.roleChangeLog.create).not.toHaveBeenCalled();
  });

  it("reads the member's current role from the effective role and logs it", async () => {
    lockedMembership([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    await resolveUserAction(
      changeRoleRequest({ userId: "target", role: "BASE" }),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    expect(transferOnRoleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fromRoles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
        toRole: OrganizationRoles.BASE,
        recipientId: "owner-user",
      })
    );
    expect(changeUserRole).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "target",
        newRole: OrganizationRoles.BASE,
        actorOwnsWorkspace: true,
      })
    );
    expect(db.roleChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousRole: OrganizationRoles.ADMIN,
        newRole: OrganizationRoles.BASE,
      }),
    });
  });

  it("hands the chosen recipient to the transfer", async () => {
    lockedMembership([OrganizationRoles.ADMIN]);

    await resolveUserAction(
      changeRoleRequest({
        userId: "target",
        role: "BASE",
        transferToUserId: "other-admin",
      }),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    expect(transferOnRoleChange).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: "other-admin" })
    );
  });

  it("locks, then authorizes and writes the role, then moves entities", async () => {
    lockedMembership([OrganizationRoles.ADMIN]);

    await resolveUserAction(
      changeRoleRequest({ userId: "target", role: "BASE" }),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    // The lock runs on the role change's own transaction client.
    expect(lockMembership).toHaveBeenCalledWith(db, {
      userId: "target",
      organizationId: "org-1",
    });
    const lockOrder = vi.mocked(lockMembership).mock.invocationCallOrder[0];
    const transferOrder =
      vi.mocked(transferOnRoleChange).mock.invocationCallOrder[0];
    const roleWriteOrder =
      vi.mocked(changeUserRole).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(roleWriteOrder);
    expect(roleWriteOrder).toBeLessThan(transferOrder);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("moves nothing when the role change is refused", async () => {
    lockedMembership([OrganizationRoles.ADMIN]);
    vi.mocked(changeUserRole).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Only the workspace owner can change an Administrator's role.",
        label: "Team",
        status: 403,
      })
    );

    await expect(
      resolveUserAction(
        changeRoleRequest({
          userId: "target",
          role: "BASE",
          transferToUserId: "not-a-member",
        }),
        "org-1",
        "admin-user",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toMatchObject({ status: 403 });

    // Authorization comes first: no entity row is touched and nothing about
    // the recipient is checked or revealed.
    expect(transferOnRoleChange).not.toHaveBeenCalled();
    expect(db.roleChangeLog.create).not.toHaveBeenCalled();
  });

  it("answers a change aimed at the owner with the owner refusal, not a recipient error", async () => {
    // The target is the workspace owner (the organization's `userId`), so
    // with no recipient chosen the default recipient would be the target.
    lockedMembership([OrganizationRoles.OWNER]);
    vi.mocked(changeUserRole).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message:
          "Cannot change the Owner's role. Use ownership transfer instead.",
        label: "Team",
        status: 403,
      })
    );

    await expect(
      resolveUserAction(
        changeRoleRequest({ userId: "owner-user", role: "ADMIN" }),
        "org-1",
        "co-admin",
        accessFor([OrganizationRoles.ADMIN])
      )
    ).rejects.toThrow(/Cannot change the Owner's role/);
    expect(transferOnRoleChange).not.toHaveBeenCalled();
  });

  it("refuses a member whose membership is gone under the lock, with nothing moved", async () => {
    lockedMembership(null);

    await expect(
      resolveUserAction(
        changeRoleRequest({ userId: "target", role: "BASE" }),
        "org-1",
        "owner-user",
        accessFor([OrganizationRoles.OWNER])
      )
    ).rejects.toMatchObject({ status: 404 });
    expect(transferOnRoleChange).not.toHaveBeenCalled();
    expect(changeUserRole).not.toHaveBeenCalled();
    expect(db.roleChangeLog.create).not.toHaveBeenCalled();
  });

  it("records a manual role change with source MANUAL", async () => {
    lockedMembership([OrganizationRoles.BASE]);
    vi.mocked(transferOnRoleChange).mockResolvedValue({
      ownership: false,
      bookingsCreatedForOthers: false,
    });

    await resolveUserAction(
      changeRoleRequest({ userId: "target", role: "SELF_SERVICE" }),
      "org-1",
      "owner-user",
      accessFor([OrganizationRoles.OWNER])
    );

    expect(db.roleChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changedById: "owner-user",
        source: "MANUAL",
        previousRole: OrganizationRoles.BASE,
        newRole: OrganizationRoles.SELF_SERVICE,
      }),
    });
  });
});
