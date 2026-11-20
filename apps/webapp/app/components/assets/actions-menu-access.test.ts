/**
 * The asset page shows its Actions menu to every role: Base and Self service
 * through `problemReport: create`, the others through an asset write.
 *
 * @see {@link file://./actions-menu-access.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canOpenAssetActionsMenu } from "./actions-menu-access";

describe("canOpenAssetActionsMenu", () => {
  it.each([
    OrganizationRoles.OWNER,
    OrganizationRoles.ADMIN,
    OrganizationRoles.MANAGER,
    OrganizationRoles.SELF_SERVICE,
    OrganizationRoles.BASE,
  ])("offers the menu to %s", (role) => {
    expect(canOpenAssetActionsMenu([role])).toBe(true);
  });

  it("offers nothing without a role", () => {
    expect(canOpenAssetActionsMenu([])).toBe(false);
    expect(canOpenAssetActionsMenu(undefined)).toBe(false);
  });
});
