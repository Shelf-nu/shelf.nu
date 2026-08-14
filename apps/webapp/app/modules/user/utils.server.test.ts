/**
 * User Action Resolver — role guards
 *
 * Two things are pinned here:
 *
 * 1. The "resend invite" path cannot mint an OWNER invite. The handler takes a
 *    free-text `userFriendlyRole` and reverse-maps it through
 *    `organizationRolesMap`, which contains an OWNER entry because it doubles
 *    as the team-list display map. Found by sweeping siblings while fixing
 *    detail.dev finding D032, which reported only the CSV import path.
 *
 * 2. The "revoke access" path respects the same role hierarchy `changeUserRole`
 *    enforces — only the OWNER may act on an ADMIN. Otherwise an ADMIN refused
 *    a role change can simply revoke that ADMIN's access instead, which is the
 *    stronger action. (detail.dev finding D058.)
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../invite/roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        OrganizationRoles.ADMIN
      )
    ).rejects.toThrow(/invalid role/i);

    // The invite must never be created — that write is the escalation
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("still resends an invite for an invitable role", async () => {
    await resolveUserAction(
      resendRequest("Administrator"),
      "org-1",
      "admin-user",
      OrganizationRoles.ADMIN
    );

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ roles: [OrganizationRoles.ADMIN] })
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
        OrganizationRoles.ADMIN
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
      OrganizationRoles.OWNER
    );

    expect(revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "some-admin",
      organizationId: "org-1",
    });
  });

  it("still lets an ADMIN revoke a BASE user's access", async () => {
    userOrgMock.mockResolvedValue({
      roles: [OrganizationRoles.BASE],
    } as never);

    await resolveUserAction(
      revokeRequest("base-user"),
      "org-1",
      "admin-user",
      OrganizationRoles.ADMIN
    );

    expect(revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "base-user",
      organizationId: "org-1",
    });
  });
});
