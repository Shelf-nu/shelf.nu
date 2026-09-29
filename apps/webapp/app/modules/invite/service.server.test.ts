/**
 * Invite Service tests
 *
 * - Role validation at acceptance: creation-time guards cannot protect an
 *   invite that already exists, so an invite granting a non-invitable role is
 *   refused when it is accepted.
 * - SCIM-managed domains refuse invites.
 * - Email letter case: invitee emails are stored lowercased, and every match
 *   against a stored email (invites, users, the signed-in user) ignores case,
 *   because stored rows can still hold capitals.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./helpers.ts}
 * @see {@link file://./roles.ts}
 */

import type { Invite } from "@prisma/client";
import { InviteStatuses, OrganizationRoles } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { caseInsensitiveEmailFilter, normalizeInviteEmail } from "./helpers";
import {
  bulkInviteUsers,
  checkUserAndInviteMatch,
  createInvite,
  updateInviteStatus,
} from "./service.server";
import { createTeamMember } from "../team-member/service.server";
import { createUserOrAttachOrg } from "../user/service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  invite: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createManyAndReturn: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  teamMember: {
    update: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

// why: isolating the invite logic from the database
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: acceptance creates the user and the org association — the write this
// test is asserting must NOT happen
vi.mock("../user/service.server", () => ({
  createUserOrAttachOrg: vi.fn(),
}));

// why: creating a team member is a database write; the tests assert whether
// it happens, not how
vi.mock("../team-member/service.server", () => ({
  createTeamMember: vi.fn(),
}));

// why: invites and acceptance send emails
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

// why: rendering the HTML email is unrelated to who the invite is for
vi.mock("~/emails/invite-template", () => ({
  invitationTemplateString: vi.fn().mockResolvedValue("<html></html>"),
}));

const ssoMock = vi.hoisted(() => ({
  checkDomainSSOStatus: vi.fn(),
  doesSSOUserExist: vi.fn(),
}));
// why: the SSO lookups are two database round trips against the auth schema.
// Stubbing them lets each case state a domain-ownership situation directly,
// which is the input the invite guard branches on.
vi.mock("~/utils/sso.server", () => ssoMock);

/** Builds a PENDING invite row as `db.invite.findFirst` would return it */
function pendingInvite(
  roles: OrganizationRoles[],
  inviteeEmail = "invitee@example.com"
) {
  return {
    id: "invite-1",
    inviteeEmail,
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

  it("accepts an invite stored with capitals for the lowercase account", async () => {
    dbMock.invite.findFirst.mockResolvedValue(
      pendingInvite([OrganizationRoles.BASE], "First.Last@School.org")
    );

    await updateInviteStatus({
      id: "invite-1",
      status: InviteStatuses.ACCEPTED,
      password: "hunter2hunter2",
    });

    expect(createUserOrAttachOrg).toHaveBeenCalledWith(
      expect.objectContaining({ email: "first.last@school.org" })
    );
    // Other pending invites for the same person close, whatever their case
    expect(dbMock.invite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inviteeEmail: { in: ["first.last@school.org"], mode: "insensitive" },
        }),
      })
    );
  });
});

describe("invite email helpers", () => {
  it("trims and lowercases an invitee email", () => {
    expect(normalizeInviteEmail("  First.Last@School.ORG ")).toBe(
      "first.last@school.org"
    );
  });

  it("matches with `in`, which Prisma compiles to an exact LOWER() comparison", () => {
    // `equals` + insensitive compiles to an unescaped ILIKE, where `_` in an
    // address would match any character.
    expect(caseInsensitiveEmailFilter(["First_Last@School.org"])).toEqual({
      in: ["first_last@school.org"],
      mode: "insensitive",
    });
    expect(caseInsensitiveEmailFilter("A@B.org")).toEqual({
      in: ["a@b.org"],
      mode: "insensitive",
    });
  });
});

describe(checkUserAndInviteMatch.name, () => {
  const context = {
    getSession: () => ({ userId: "user-1" }),
  } as unknown as AppLoadContext;
  const invite = { inviteeEmail: "First.Last@School.org" } as Invite;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the invited person in when only the letter case differs", async () => {
    dbMock.user.findFirst.mockResolvedValue({ email: "first.last@school.org" });

    await expect(
      checkUserAndInviteMatch({ context, invite })
    ).resolves.toBeUndefined();
  });

  it("still refuses a different signed-in person", async () => {
    dbMock.user.findFirst.mockResolvedValue({
      email: "someone.else@school.org",
    });

    await expect(
      checkUserAndInviteMatch({ context, invite })
    ).rejects.toMatchObject({ title: "Wrong user" });
  });

  it("refuses when the signed-in user cannot be found", async () => {
    dbMock.user.findFirst.mockResolvedValue(null);

    await expect(
      checkUserAndInviteMatch({ context, invite })
    ).rejects.toMatchObject({ title: "Wrong user" });
  });
});

describe("createInvite: earlier invites of the same person", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ssoMock.checkDomainSSOStatus.mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
    });
    dbMock.user.findFirst.mockResolvedValue(null);
    vi.mocked(createTeamMember).mockResolvedValue({
      id: "tm-new",
    } as Awaited<ReturnType<typeof createTeamMember>>);
    dbMock.invite.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "invite-new",
        inviteeEmail: data.inviteeEmail,
        organization: { name: "Workspace", customEmailFooter: null },
        inviter: { firstName: "Owner", lastName: "Person", displayName: null },
      })
    );
  });

  it("reuses the team member of an earlier invite stored with capitals", async () => {
    dbMock.invite.findFirst.mockResolvedValue({ teamMemberId: "tm-earlier" });

    await createInvite({
      organizationId: "org-1",
      inviteeEmail: "first.last@school.org",
      inviterId: "user-1",
      roles: [OrganizationRoles.BASE],
      teamMemberName: "first.last",
      userId: "user-1",
    });

    expect(dbMock.invite.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        inviteeEmail: { in: ["first.last@school.org"], mode: "insensitive" },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(createTeamMember).not.toHaveBeenCalled();
    expect(dbMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inviteeTeamMember: { connect: { id: "tm-earlier" } },
        }),
      })
    );
  });

  it("stores the email lowercased", async () => {
    dbMock.invite.findFirst.mockResolvedValue(null);

    await createInvite({
      organizationId: "org-1",
      inviteeEmail: " First.Last@School.org ",
      inviterId: "user-1",
      roles: [OrganizationRoles.BASE],
      teamMemberName: "First.Last",
      userId: "user-1",
    });

    expect(createTeamMember).toHaveBeenCalledTimes(1);
    expect(dbMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inviteeEmail: "first.last@school.org",
        }),
      })
    );
  });
});

describe("bulkInviteUsers", () => {
  type BulkUsers = Parameters<typeof bulkInviteUsers>[0]["users"];

  /** Builds CSV rows the way the import route hands them over */
  const rows = (...emails: string[]) =>
    emails.map((email) => ({ email, role: "BASE" })) as BulkUsers;

  /** The rows the bulk insert wrote, as `{ inviteeEmail, teamMemberId }` */
  const createdInvites = () =>
    (dbMock.invite.createManyAndReturn.mock.calls[0]?.[0]?.data ?? []).map(
      (invite: { inviteeEmail: string; teamMemberId: string }) => ({
        inviteeEmail: invite.inviteeEmail,
        teamMemberId: invite.teamMemberId,
      })
    );

  /** The team members the bulk insert created, as `{ id, name }` */
  const createdTeamMembers = () =>
    (dbMock.teamMember.createMany.mock.calls[0]?.[0]?.data ?? []).map(
      (member: { id: string; name: string }) => ({
        id: member.id,
        name: member.name,
      })
    );

  /** Runs the import for `org-1` as `user-1`. */
  const importRows = (users: BulkUsers) =>
    bulkInviteUsers({ users, userId: "user-1", organizationId: "org-1" });

  beforeEach(() => {
    vi.clearAllMocks();
    ssoMock.checkDomainSSOStatus.mockResolvedValue({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
    });
    dbMock.teamMember.findMany.mockResolvedValue([]);
    dbMock.user.findMany.mockResolvedValue([]);
    dbMock.invite.findMany.mockResolvedValue([]);
    dbMock.$transaction.mockImplementation((callback) => callback(dbMock));
    dbMock.teamMember.createMany.mockResolvedValue({ count: 0 });
    // No invites returned means no emails are scheduled after the test ends.
    dbMock.invite.createManyAndReturn.mockResolvedValue([]);
  });

  describe("validates the whole file before writing", () => {
    it("refuses a file with an address that is not an email, and writes nothing", async () => {
      const refused = importRows(
        rows("new.person@school.org", "Evan Williams")
      );

      await expect(refused).rejects.toMatchObject({
        status: 400,
        shouldBeCaptured: false,
        additionalData: expect.objectContaining({
          totalErrors: 1,
          rowErrors: [
            {
              row: 3,
              title: "Invalid email",
              message: '"Evan Williams" is not a valid email address.',
            },
          ],
        }),
      });
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses a row granting OWNER, and invites no one from the file", async () => {
      // The role column flows into `Invite.roles`, and permissions resolve
      // from the roles an accepted invite grants, so an unvalidated OWNER is a
      // full privilege escalation (detail.dev D032).
      const refused = importRows([
        { email: "fine@example.com", role: "ADMIN" },
        { email: "attacker@example.com", role: "OWNER" },
      ] as BulkUsers);

      await expect(refused).rejects.toMatchObject({
        status: 400,
        additionalData: expect.objectContaining({
          rowErrors: [
            expect.objectContaining({ row: 3, title: "Invalid role" }),
          ],
        }),
      });
      expect(dbMock.invite.createManyAndReturn).not.toHaveBeenCalled();
    });

    it("refuses a team member id that is not in this workspace", async () => {
      // The workspace-scoped lookup finds nothing for an id from another
      // workspace, which is what makes it unknown here.
      const refused = importRows([
        { email: "a@school.org", role: "BASE", teamMemberId: "tm-other-org" },
      ] as BulkUsers);

      await expect(refused).rejects.toMatchObject({
        status: 400,
        additionalData: expect.objectContaining({
          rowErrors: [
            expect.objectContaining({ title: "Unknown team member" }),
          ],
        }),
      });
      expect(dbMock.teamMember.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["tm-other-org"] }, organizationId: "org-1" },
        select: { id: true, userId: true },
      });
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses an address listed twice with different capitals", async () => {
      await expect(
        importRows(rows("First.Last@School.org", "first.last@school.org"))
      ).rejects.toMatchObject({
        status: 400,
        additionalData: expect.objectContaining({
          rowErrors: [
            expect.objectContaining({ row: 3, title: "Duplicate email" }),
          ],
        }),
      });
      expect(dbMock.$transaction).not.toHaveBeenCalled();
    });

    it("checks SSO once per domain, not once per row", async () => {
      await importRows(rows("a@school.org", "b@school.org", "c@other.org"));

      expect(ssoMock.checkDomainSSOStatus).toHaveBeenCalledTimes(2);
      expect(ssoMock.doesSSOUserExist).not.toHaveBeenCalled();
    });

    it("refuses Pure SSO addresses with no SSO account, from one lookup", async () => {
      ssoMock.checkDomainSSOStatus.mockResolvedValue({
        isConfiguredForSSO: true,
        linkedOrganizations: [],
        ssoProviderId: "provider-1",
      });
      // Only b@acme.com has signed in through SSO before.
      dbMock.user.findMany.mockImplementation(
        (args: { where: { sso?: boolean } }) =>
          Promise.resolve(args.where.sso ? [{ email: "B@acme.com" }] : [])
      );

      await expect(
        importRows(rows("a@acme.com", "b@acme.com"))
      ).rejects.toMatchObject({
        additionalData: expect.objectContaining({
          rowErrors: [expect.objectContaining({ row: 2, title: "SSO" })],
        }),
      });
    });
  });

  describe("creates a team member per new invitee", () => {
    it("creates team members only for rows that do not name one", async () => {
      dbMock.teamMember.findMany.mockResolvedValue([
        { id: "tm-existing", userId: null },
      ]);

      await importRows([
        {
          email: "linked@school.org",
          role: "BASE",
          teamMemberId: "tm-existing",
        },
        { email: "new.person@school.org", role: "BASE" },
      ] as BulkUsers);

      const members = createdTeamMembers();
      expect(members).toEqual([{ id: expect.any(String), name: "new.person" }]);
      expect(createdInvites()).toEqual([
        { inviteeEmail: "linked@school.org", teamMemberId: "tm-existing" },
        { inviteeEmail: "new.person@school.org", teamMemberId: members[0].id },
      ]);
    });

    it("gives two invitees with the same name their own team members", async () => {
      // Both addresses start with "john", so the name cannot tell them apart.
      await importRows(rows("john@a.com", "john@b.com"));

      const members = createdTeamMembers();
      expect(members).toHaveLength(2);
      expect(members[0].id).not.toBe(members[1].id);
      expect(createdInvites()).toEqual([
        { inviteeEmail: "john@a.com", teamMemberId: members[0].id },
        { inviteeEmail: "john@b.com", teamMemberId: members[1].id },
      ]);
    });
  });

  it("keeps the name as typed for the new team member", async () => {
    await importRows(rows("First.Last@School.org"));

    expect(createdInvites()).toEqual([
      {
        inviteeEmail: "first.last@school.org",
        teamMemberId: createdTeamMembers()[0].id,
      },
    ]);
    // The team member keeps the address as typed; it seeds the first name.
    expect(createdTeamMembers()).toEqual([
      { id: expect.any(String), name: "First.Last" },
    ]);
  });

  it("skips a row for a member whose stored email has other capitals", async () => {
    dbMock.user.findMany.mockResolvedValue([{ email: "Member@School.org" }]);

    const result = await importRows(
      rows("member@school.org", "New.Person@School.org")
    );

    expect(dbMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: {
            in: ["member@school.org", "new.person@school.org"],
            mode: "insensitive",
          },
        }),
      })
    );
    expect(result.skippedUsers.map((user) => user.email)).toEqual([
      "member@school.org",
    ]);
    expect(createdInvites()).toEqual([
      {
        inviteeEmail: "new.person@school.org",
        teamMemberId: createdTeamMembers()[0].id,
      },
    ]);
  });

  it("still invites a new person when another has two pending invites", async () => {
    // One person, two pending rows that differ only by case
    dbMock.invite.findMany.mockResolvedValue([
      { inviteeEmail: "Pending@School.org" },
      { inviteeEmail: "pending@school.org" },
    ]);

    const result = await importRows(
      rows("pending@school.org", "new.person@school.org")
    );

    expect(result.skippedUsers.map((user) => user.email)).toEqual([
      "pending@school.org",
    ]);
    expect(createdInvites()).toEqual([
      {
        inviteeEmail: "new.person@school.org",
        teamMemberId: createdTeamMembers()[0].id,
      },
    ]);
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
