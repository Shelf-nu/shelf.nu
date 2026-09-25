/**
 * changeUserRole: the refusals a role change applies before it writes, read
 * from the member's whole membership and whether the actor owns the workspace.
 *
 * @see {@link file://./service.server.ts} changeUserRole
 */
// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { changeUserRole } from "./service.server";

// why: testing role change validation logic without actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    userOrganization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const ORG_ID = "org-1";
const USER_ID = "user-1";

function mockUserOrg(roles: OrganizationRoles[]) {
  vi.mocked(db.userOrganization.findFirst).mockResolvedValue({
    id: "uo-1",
    userId: USER_ID,
    organizationId: ORG_ID,
    roles,
    createdAt: new Date(),
    updatedAt: new Date(),
    calendarTokenId: null,
  });
}

function mockUpdateSuccess(newRole: OrganizationRoles) {
  vi.mocked(db.userOrganization.update).mockResolvedValue({
    id: "uo-1",
    userId: USER_ID,
    organizationId: ORG_ID,
    roles: [newRole],
    createdAt: new Date(),
    updatedAt: new Date(),
    calendarTokenId: null,
  });
}

describe("changeUserRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects assigning OWNER role", async () => {
    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.OWNER,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toThrow(ShelfError);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.OWNER,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toThrow(/Cannot assign Owner role/);
  });

  it("rejects when user is not a member", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValue(null);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.BASE,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toThrow(/not a member/);
  });

  it("rejects changing the OWNER's role", async () => {
    mockUserOrg([OrganizationRoles.OWNER]);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.ADMIN,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toThrow(/Cannot change the Owner's role/);
  });

  it("rejects ADMIN caller promoting to ADMIN", async () => {
    mockUserOrg([OrganizationRoles.BASE]);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.ADMIN,
        actorOwnsWorkspace: false,
        tx: db,
      })
    ).rejects.toThrow(/Only the workspace owner can promote/);
  });

  it("rejects ADMIN caller demoting another ADMIN", async () => {
    mockUserOrg([OrganizationRoles.ADMIN]);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.BASE,
        actorOwnsWorkspace: false,
        tx: db,
      })
    ).rejects.toThrow(/Only the workspace owner can change an Administrator/);
  });

  it("allows OWNER to promote BASE to ADMIN", async () => {
    mockUserOrg([OrganizationRoles.BASE]);
    mockUpdateSuccess(OrganizationRoles.ADMIN);

    const result = await changeUserRole({
      userId: USER_ID,
      organizationId: ORG_ID,
      newRole: OrganizationRoles.ADMIN,
      actorOwnsWorkspace: true,
      tx: db,
    });

    expect(result.previousRole).toBe(OrganizationRoles.BASE);
    expect(db.userOrganization.update).toHaveBeenCalledWith({
      where: {
        userId_organizationId: {
          userId: USER_ID,
          organizationId: ORG_ID,
        },
      },
      data: {
        roles: { set: [OrganizationRoles.ADMIN] },
      },
    });
  });

  it("allows OWNER to demote ADMIN to BASE", async () => {
    mockUserOrg([OrganizationRoles.ADMIN]);
    mockUpdateSuccess(OrganizationRoles.BASE);

    const result = await changeUserRole({
      userId: USER_ID,
      organizationId: ORG_ID,
      newRole: OrganizationRoles.BASE,
      actorOwnsWorkspace: true,
      tx: db,
    });

    expect(result.previousRole).toBe(OrganizationRoles.ADMIN);
  });

  it("allows ADMIN to change BASE to SELF_SERVICE", async () => {
    mockUserOrg([OrganizationRoles.BASE]);
    mockUpdateSuccess(OrganizationRoles.SELF_SERVICE);

    const result = await changeUserRole({
      userId: USER_ID,
      organizationId: ORG_ID,
      newRole: OrganizationRoles.SELF_SERVICE,
      actorOwnsWorkspace: false,
      tx: db,
    });

    expect(result.previousRole).toBe(OrganizationRoles.BASE);
  });

  it("refuses changing a member who holds OWNER anywhere in the membership", async () => {
    mockUserOrg([OrganizationRoles.ADMIN, OrganizationRoles.OWNER]);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.BASE,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toThrow(/Cannot change the Owner's role/);
    expect(db.userOrganization.update).not.toHaveBeenCalled();
  });

  it("an ADMIN may not change a member stored as [SELF_SERVICE, ADMIN]", async () => {
    mockUserOrg([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.BASE,
        actorOwnsWorkspace: false,
        tx: db,
      })
    ).rejects.toThrow(/Only the workspace owner can change an Administrator/);
    expect(db.userOrganization.update).not.toHaveBeenCalled();
  });

  it("reports the effective role as the previous role of a mixed membership", async () => {
    mockUserOrg([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);
    mockUpdateSuccess(OrganizationRoles.BASE);

    const result = await changeUserRole({
      userId: USER_ID,
      organizationId: ORG_ID,
      newRole: OrganizationRoles.BASE,
      actorOwnsWorkspace: true,
      tx: db,
    });

    expect(result.previousRole).toBe(OrganizationRoles.ADMIN);
  });

  it("refuses the two owner cases with client statuses, not a 500", async () => {
    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.OWNER,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toMatchObject({ status: 400 });

    mockUserOrg([OrganizationRoles.OWNER]);
    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.ADMIN,
        actorOwnsWorkspace: true,
        tx: db,
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
