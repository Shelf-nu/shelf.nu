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

import { updateInviteStatus } from "./service.server";
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
