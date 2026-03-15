// @vitest-environment node
import { OrganizationRoles } from "@shelf/database";
import { describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { findFirst, update } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";
import { changeUserRole } from "./service.server";

// why: stub db object so service.server.ts can pass it to query helpers
vi.mock("~/database/db.server", () => ({
  db: {},
}));

// why: auto-mock query helpers so we can control return values per test
vi.mock("~/database/query-helpers.server");

const ORG_ID = "org-1";
const USER_ID = "user-1";

function mockUserOrg(roles: OrganizationRoles[]) {
  vi.mocked(findFirst).mockResolvedValue({
    id: "uo-1",
    userId: USER_ID,
    organizationId: ORG_ID,
    roles,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
}

function mockUpdateSuccess(newRole: OrganizationRoles) {
  vi.mocked(update).mockResolvedValue({
    id: "uo-1",
    userId: USER_ID,
    organizationId: ORG_ID,
    roles: [newRole],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
}

describe("changeUserRole", () => {
  it("rejects assigning OWNER role", async () => {
    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.OWNER,
        callerRole: OrganizationRoles.OWNER,
      })
    ).rejects.toThrow(ShelfError);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.OWNER,
        callerRole: OrganizationRoles.OWNER,
      })
    ).rejects.toThrow(/Cannot assign Owner role/);
  });

  it("rejects when user is not a member", async () => {
    vi.mocked(findFirst).mockResolvedValue(null as any);

    await expect(
      changeUserRole({
        userId: USER_ID,
        organizationId: ORG_ID,
        newRole: OrganizationRoles.BASE,
        callerRole: OrganizationRoles.OWNER,
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
        callerRole: OrganizationRoles.OWNER,
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
        callerRole: OrganizationRoles.ADMIN,
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
        callerRole: OrganizationRoles.ADMIN,
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
      callerRole: OrganizationRoles.OWNER,
    });

    expect(result.previousRole).toBe(OrganizationRoles.BASE);
    expect(update).toHaveBeenCalledWith(db, "UserOrganization", {
      where: {
        userId: USER_ID,
        organizationId: ORG_ID,
      },
      data: {
        roles: [OrganizationRoles.ADMIN],
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
      callerRole: OrganizationRoles.OWNER,
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
      callerRole: OrganizationRoles.ADMIN,
    });

    expect(result.previousRole).toBe(OrganizationRoles.BASE);
  });
});
