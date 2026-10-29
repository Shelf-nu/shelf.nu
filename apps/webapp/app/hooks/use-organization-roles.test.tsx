/**
 * Tests for {@link useOrganizationRoles}: it hands out the member's roles from
 * the `_layout` loader carrying that workspace's permission switches
 * (`roleAccess.workspaceGrants`), so `userHasPermission` over them answers
 * what the owner switched on without being told.
 *
 * @see {@link file://./use-organization-roles.ts}
 * @see {@link file://./../utils/permissions/member-roles.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { useOrganizationRoles } from "./use-organization-roles";

// why: the hook reads the `_layout` route's loader data, which needs a data
// router; the roles and the switches in that payload are the input under test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useRouteLoaderData: vi.fn() };
});

/**
 * Serves the `_layout` loader payload of a member holding `roles` in a
 * workspace whose "Managers can edit assets" is `managersCanEditAssets`, and
 * nothing for any other route.
 */
function givenLayout(
  roles: OrganizationRoles[],
  { managersCanEditAssets }: { managersCanEditAssets: boolean }
) {
  vi.mocked(useRouteLoaderData).mockImplementation((routeId: string) =>
    routeId === "routes/_layout+/_layout"
      ? {
          currentOrganizationUserRoles: roles,
          roleAccess: accessFor(roles, { managersCanEditAssets }),
        }
      : undefined
  );
}

/** Whether the roles the hook returns may edit an asset. */
function mayUpdateAssets() {
  const { result } = renderHook(() => useOrganizationRoles());
  return userHasPermission({
    roles: result.current,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });
}

describe("useOrganizationRoles", () => {
  it("returns the layout's roles carrying the workspace's switches", () => {
    givenLayout([OrganizationRoles.MANAGER], { managersCanEditAssets: true });

    const { result } = renderHook(() => useOrganizationRoles());

    expect([...(result.current ?? [])]).toEqual([OrganizationRoles.MANAGER]);
    expect(result.current?.workspaceGrants).toEqual({
      managersCanEditAssets: true,
    });
  });

  it("lets a Manager update assets once the switch is on", () => {
    givenLayout([OrganizationRoles.MANAGER], { managersCanEditAssets: true });

    expect(mayUpdateAssets()).toBe(true);
  });

  it("keeps a Manager from updating assets while the switch is off", () => {
    givenLayout([OrganizationRoles.MANAGER], { managersCanEditAssets: false });

    expect(mayUpdateAssets()).toBe(false);
  });

  it("keeps a Base member from updating assets whatever the switch", () => {
    givenLayout([OrganizationRoles.BASE], { managersCanEditAssets: true });

    expect(mayUpdateAssets()).toBe(false);
  });

  it("returns nothing, and so grants nothing, before the layout data loads", () => {
    vi.mocked(useRouteLoaderData).mockReturnValue(undefined);

    const { result } = renderHook(() => useOrganizationRoles());

    expect(result.current).toBeUndefined();
    expect(mayUpdateAssets()).toBe(false);
  });
});
