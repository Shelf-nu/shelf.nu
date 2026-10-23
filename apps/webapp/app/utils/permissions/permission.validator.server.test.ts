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
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      })
    ).resolves.toBe(true);
  });

  it("loads roles from the DB when not supplied and applies the matrix", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValueOnce({
      roles: [OrganizationRoles.BASE],
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

describe("validatePermission", () => {
  it("throws a 403 ShelfError when the permission is denied", async () => {
    await expect(
      validatePermission({
        ...base,
        roles: [OrganizationRoles.BASE],
        entity: PermissionEntity.asset,
        action: PermissionAction.delete,
      })
    ).rejects.toMatchObject({ status: 403, title: "Unauthorized" });
  });
});
