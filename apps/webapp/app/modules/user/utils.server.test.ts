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
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../invite/roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { createInvite } from "~/modules/invite/service.server";
import { revokeAccessToOrganization } from "./service.server";
import { resolveUserAction } from "./utils.server";

// @vitest-environment node

// why: the resend path writes invites and sends email
vi.mock("../invite/service.server", () => ({ createInvite: vi.fn() }));

// why: revocation deletes rows and sends email; the guard under test must stop
// it before that happens
vi.mock("./service.server", () => ({
  revokeAccessToOrganization: vi.fn(),
  changeUserRole: vi.fn(),
  transferEntitiesToNewOwner: vi.fn(),
}));

// why: resend invalidates prior invites for the same invitee first
vi.mock("~/database/db.server", () => ({
  db: {
    invite: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    userOrganization: { findFirst: vi.fn() },
    organization: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ name: "Org", customEmailFooter: null }),
    },
  },
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
    });
  });
});
