/**
 * The Archived tab is the one place a user can see and reinstate archived
 * assets. Which roles get it is a product decision (issue #382), so it is
 * pinned here rather than left to whatever the permission matrix drifts to.
 *
 * BASE and SELF_SERVICE exist to consume the AVAILABLE inventory — BASE plans
 * bookings and runs audits, SELF_SERVICE runs a booking end to end. An
 * archived asset is out of service and neither role can reinstate it, so the
 * tab would show them things they can neither use nor fix.
 *
 * @see {@link file://./use-can-archive-assets.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

/**
 * The exact check `useCanArchiveAssets` performs. Asserted directly so the
 * test needs no React route-loader context — the hook is a thin wrapper whose
 * only logic IS this call.
 */
const canArchive = (roles: OrganizationRoles[]) =>
  userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });

describe("who sees the Archived tab", () => {
  it("shows it to OWNER and ADMIN, who can archive and reinstate", () => {
    expect(canArchive([OrganizationRoles.OWNER])).toBe(true);
    expect(canArchive([OrganizationRoles.ADMIN])).toBe(true);
  });

  it("hides it from BASE, who plans bookings and cannot reinstate", () => {
    expect(canArchive([OrganizationRoles.BASE])).toBe(false);
  });

  it("hides it from SELF_SERVICE, who books and takes custody for themselves", () => {
    expect(canArchive([OrganizationRoles.SELF_SERVICE])).toBe(false);
  });

  it("hides it when the role list is empty", () => {
    // why: `useUserRoleHelper` returns undefined roles before the layout
    // loader resolves; the gate must fail closed, not flash the tab.
    expect(canArchive([])).toBe(false);
  });
});
