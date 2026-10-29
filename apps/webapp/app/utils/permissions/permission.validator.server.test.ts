/**
 * Behavior tests for the server permission validator after the extraction of
 * the matrix + resolver into `@shelf/permissions`.
 *
 * Guards the properties the extraction must preserve:
 * 1. ADMIN / OWNER allow-all short-circuit (effective behavior that never
 *    lived in the raw matrix).
 * 2. Matrix-driven denies/grants for BASE / SELF_SERVICE.
 * 3. The 403 ShelfError when the user is not an org member.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "@shelf/permissions";
import { describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

import {
  hasPermission,
  validatePermission,
} from "./permission.validator.server";

// why: no CI database — the validator's only DB touch is the roles lookup,
// which these tests either bypass (roles passed in) or stub explicitly.
vi.mock("~/database/db.server", () => ({
  db: { userOrganization: { findFirst: vi.fn() } },
}));

const base = {
  userId: "user-1",
  organizationId: "org-1",
};

describe("hasPermission", () => {
  it("short-circuits ADMIN to allow-all, even for actions absent from the matrix", async () => {
    // qr:update appears in NO role's matrix entry — only the short-circuit grants it.
    expect(
      Role2PermissionMap.ADMIN?.[PermissionEntity.qr].includes(
        PermissionAction.update
      )
    ).toBe(false);
    await expect(
      hasPermission({
        ...base,
        roles: [OrganizationRoles.ADMIN],
        workspace: null,
        entity: PermissionEntity.qr,
        action: PermissionAction.update,
      })
    ).resolves.toBe(true);
  });

  it("short-circuits OWNER to allow-all", async () => {
    await expect(
      hasPermission({
        ...base,
        roles: [OrganizationRoles.OWNER],
        workspace: null,
        entity: PermissionEntity.workspace,
        action: PermissionAction.delete,
      })
    ).resolves.toBe(true);
  });

  it("denies BASE an asset create per the matrix", async () => {
    await expect(
      hasPermission({
        ...base,
        roles: [OrganizationRoles.BASE],
        workspace: null,
        entity: PermissionEntity.asset,
        action: PermissionAction.create,
      })
    ).resolves.toBe(false);
  });

  it("grants SELF_SERVICE booking checkout per the matrix", async () => {
    await expect(
      hasPermission({
        ...base,
        roles: [OrganizationRoles.SELF_SERVICE],
        workspace: null,
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      })
    ).resolves.toBe(true);
  });

  it("loads roles from the DB when not supplied and applies the matrix", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValueOnce({
      roles: [OrganizationRoles.BASE],
      workspace: null,
      // why: only `roles` is read by the validator; the rest of the row is
      // irrelevant to the behavior under test.
    } as never);
    await expect(
      hasPermission({
        ...base,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    ).resolves.toBe(true);
  });

  it("wraps non-membership in a ShelfError", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValueOnce(null);
    await expect(
      hasPermission({
        ...base,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    ).rejects.toMatchObject({ message: "Error while checking permission" });
  });
});

describe("hasPermission with workspace switches", () => {
  const managerUpdatesAsset = {
    ...base,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  };

  it.each([
    [true, true],
    [false, false],
  ])(
    "loads managersCanEditAssets=%s with the roles and lets a Manager update assets: %s",
    async (managersCanEditAssets, expected) => {
      vi.mocked(db.userOrganization.findFirst).mockResolvedValueOnce({
        roles: [OrganizationRoles.MANAGER],
        organization: { managersCanEditAssets },
        // why: the validator reads only the roles and the switches.
      } as never);

      await expect(hasPermission(managerUpdatesAsset)).resolves.toBe(expected);
      expect(db.userOrganization.findFirst).toHaveBeenLastCalledWith({
        where: { userId: "user-1", organizationId: "org-1" },
        select: {
          roles: true,
          organization: { select: { managersCanEditAssets: true } },
        },
      });
    }
  );

  it("reads the switches the caller supplies with the roles", async () => {
    await expect(
      hasPermission({
        ...managerUpdatesAsset,
        roles: [OrganizationRoles.MANAGER],
        workspace: { managersCanEditAssets: true },
      })
    ).resolves.toBe(true);
    await expect(
      hasPermission({
        ...managerUpdatesAsset,
        roles: [OrganizationRoles.MANAGER],
        workspace: null,
      })
    ).resolves.toBe(false);
  });

  it("workspaceGrants: false refuses a Manager even with the switch on", async () => {
    await expect(
      validatePermission({
        ...managerUpdatesAsset,
        roles: [OrganizationRoles.MANAGER],
        workspace: { managersCanEditAssets: true },
        workspaceGrants: false,
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("never opens asset delete to a Manager", async () => {
    await expect(
      hasPermission({
        ...base,
        roles: [OrganizationRoles.MANAGER],
        workspace: { managersCanEditAssets: true },
        entity: PermissionEntity.asset,
        action: PermissionAction.delete,
      })
    ).resolves.toBe(false);
  });
});

describe("validatePermission", () => {
  it("throws a 403 ShelfError when the permission is denied", async () => {
    await expect(
      validatePermission({
        ...base,
        roles: [OrganizationRoles.BASE],
        workspace: null,
        entity: PermissionEntity.asset,
        action: PermissionAction.delete,
      })
    ).rejects.toMatchObject({ status: 403, title: "Unauthorized" });
  });

  it("keeps only the switches of a passed organization row in the refusal", async () => {
    const organization = {
      id: "org-1",
      managersCanEditAssets: false,
      owner: { id: "owner-1", email: "owner@example.com" },
      ssoDetails: { adminGroupId: "admins" },
    };

    const refusal = await validatePermission({
      ...base,
      roles: [OrganizationRoles.BASE],
      workspace: organization,
      entity: PermissionEntity.asset,
      action: PermissionAction.delete,
    }).catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      additionalData: { workspace: { managersCanEditAssets: false } },
    });
    expect(JSON.stringify(refusal)).not.toContain("owner@example.com");
    expect(JSON.stringify(refusal)).not.toContain("admins");
  });
});
