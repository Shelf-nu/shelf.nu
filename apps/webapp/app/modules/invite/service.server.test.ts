/**
 * Invite Service — role validation at acceptance
 *
 * Creation-time guards cannot protect an invite that already exists. A row
 * written before those guards landed still carries its stored roles, and
 * `updateInviteStatus` hands them to `createUserOrAttachOrg` verbatim, which
 * writes them into `UserOrganization.roles`. This pins that an invite granting
 * a non-invitable role is refused at acceptance instead.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./roles.ts}
 */

import { InviteStatuses, OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInvite, updateInviteStatus } from "./service.server";
import { createUserOrAttachOrg } from "../user/service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  invite: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  teamMember: { update: vi.fn() },
}));

// why: isolating the acceptance branch from the database
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: acceptance creates the user and the org association — the write this
// test is asserting must NOT happen
vi.mock("../user/service.server", () => ({
  createUserOrAttachOrg: vi.fn(),
}));

// why: acceptance sends a welcome email
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

const ssoMock = vi.hoisted(() => ({
  checkDomainSSOStatus: vi.fn(),
  doesSSOUserExist: vi.fn(),
}));
// why: the SSO lookups are two database round trips against the auth schema.
// Stubbing them lets each case state a domain-ownership situation directly,
// which is the input the invite guard branches on.
vi.mock("~/utils/sso.server", () => ssoMock);

/** Builds a PENDING invite row as `db.invite.findFirst` would return it */
function pendingInvite(roles: OrganizationRoles[]) {
  return {
    id: "invite-1",
    inviteeEmail: "invitee@example.com",
    organizationId: "org-1",
    roles,
    status: InviteStatuses.PENDING,
    expiresAt: new Date(Date.now() + 86_400_000),
    inviteeTeamMember: { id: "tm-1", name: "Invitee Person" },
  };
}

describe("updateInviteStatus — stored role validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.invite.update.mockResolvedValue({ id: "invite-1" });
    dbMock.invite.updateMany.mockResolvedValue({ count: 0 });
    dbMock.teamMember.update.mockResolvedValue({ id: "tm-1" });
    vi.mocked(createUserOrAttachOrg).mockResolvedValue({
      id: "user-1",
    } as Awaited<ReturnType<typeof createUserOrAttachOrg>>);
  });

  it("refuses an invite that grants OWNER", async () => {
    // A row that could only have been written before the creation-time guards
    dbMock.invite.findFirst.mockResolvedValue(
      pendingInvite([OrganizationRoles.OWNER])
    );

    await expect(
      updateInviteStatus({
        id: "invite-1",
        status: InviteStatuses.ACCEPTED,
        password: "hunter2hunter2",
      })
    ).rejects.toThrow(/no longer be assigned/i);

    // The org association is the escalation — it must never be written
    expect(createUserOrAttachOrg).not.toHaveBeenCalled();
  });

  it("refuses an invite mixing OWNER with an allowed role", async () => {
    dbMock.invite.findFirst.mockResolvedValue(
      pendingInvite([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])
    );

    await expect(
      updateInviteStatus({
        id: "invite-1",
        status: InviteStatuses.ACCEPTED,
        password: "hunter2hunter2",
      })
    ).rejects.toThrow(/no longer be assigned/i);

    expect(createUserOrAttachOrg).not.toHaveBeenCalled();
  });

  it("still accepts an invite for an invitable role", async () => {
    dbMock.invite.findFirst.mockResolvedValue(
      pendingInvite([OrganizationRoles.ADMIN])
    );

    await updateInviteStatus({
      id: "invite-1",
      status: InviteStatuses.ACCEPTED,
      password: "hunter2hunter2",
    });

    expect(createUserOrAttachOrg).toHaveBeenCalledWith(
      expect.objectContaining({ roles: [OrganizationRoles.ADMIN] })
    );
  });
});

describe("createInvite — SCIM-managed domains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** The minimum payload `createInvite` needs to reach its SSO guard. */
  function invitePayload(organizationId: string) {
    return {
      organizationId,
      inviteeEmail: "jane@acme.com",
      inviterId: "user-1",
      roles: [OrganizationRoles.BASE],
      teamMemberName: "Jane",
      userId: "user-1",
    };
  }

  it("refuses an invite into an organization that co-owns the domain", async () => {
    // Two organizations claim acme.com and the invite targets the second.
    // Reading a single owner answers for org-acme-eu, leaves org-acme-us
    // looking like Pure SSO, and the invite goes through — the governance
    // bypass this guard exists to close.
    ssoMock.checkDomainSSOStatus.mockResolvedValue({
      isConfiguredForSSO: true,
      linkedOrganizations: [{ id: "org-acme-eu" }, { id: "org-acme-us" }],
      ssoProviderId: "provider-1",
    });

    await expect(createInvite(invitePayload("org-acme-us"))).rejects.toThrow(
      "This email domain uses SCIM SSO for this workspace"
    );

    // Refused on ownership alone — whether the invitee happens to have an SSO
    // account is the Pure SSO question, and must not be reached.
    expect(ssoMock.doesSSOUserExist).not.toHaveBeenCalled();
    expect(dbMock.invite.updateMany).not.toHaveBeenCalled();
  });

  it("still applies the Pure SSO rule when no organization owns the domain", async () => {
    // Federated but unclaimed: the invitee must already have signed in.
    ssoMock.checkDomainSSOStatus.mockResolvedValue({
      isConfiguredForSSO: true,
      linkedOrganizations: [],
      ssoProviderId: "provider-1",
    });
    ssoMock.doesSSOUserExist.mockResolvedValue(false);

    await expect(createInvite(invitePayload("org-other"))).rejects.toThrow(
      "The user needs to sign up via SSO"
    );
  });
});
