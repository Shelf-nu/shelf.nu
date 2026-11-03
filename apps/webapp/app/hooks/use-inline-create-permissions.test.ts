/**
 * Tests for {@link useInlineCreatePermissions}: which "create new" shortcuts
 * the asset and kit forms offer.
 *
 * Each shortcut follows its entity's own `create` grant. "Managers can edit
 * assets" opens the forms to a Manager but none of these grants, so a Manager
 * picks categories, tags, locations, custom fields and asset models from the
 * existing ones only.
 *
 * @see {@link file://./use-inline-create-permissions.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemberRoles } from "~/utils/permissions/member-roles";
import { withWorkspaceGrants } from "~/utils/permissions/member-roles";
import { useInlineCreatePermissions } from "./use-inline-create-permissions";

/** The roles `useOrganizationRoles` returns for the current render. */
const caller = vi.hoisted(() => ({
  roles: undefined as MemberRoles | undefined,
}));

// why: the real hook reads the `_layout` route loader, which needs a data
// router; the roles it returns, carrying the switches, are this hook's input.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => caller.roles,
}));

/** Renders the hook for `role` in a workspace with the switch set as given. */
function inlineCreateFor(
  role: OrganizationRoles,
  managersCanEditAssets: boolean
) {
  caller.roles = withWorkspaceGrants([role], { managersCanEditAssets });
  return renderHook(() => useInlineCreatePermissions()).result.current;
}

describe("useInlineCreatePermissions", () => {
  it("offers a Manager no inline create, even with the switch on", () => {
    expect(inlineCreateFor(OrganizationRoles.MANAGER, true)).toEqual({
      category: false,
      tag: false,
      location: false,
      customField: false,
      assetModel: false,
    });
  });

  it("offers an Administrator every inline create", () => {
    expect(inlineCreateFor(OrganizationRoles.ADMIN, false)).toEqual({
      category: true,
      tag: true,
      location: true,
      customField: true,
      assetModel: true,
    });
  });
});
