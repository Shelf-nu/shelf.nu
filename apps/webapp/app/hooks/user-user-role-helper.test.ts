/**
 * Tests for {@link useUserRoleHelper}'s `effectiveRole`: the one role the
 * servers judge a membership by. Client gates that show or hide an action the
 * server may refuse read it, so they must resolve the same role the server
 * does, including for memberships that hold several roles.
 *
 * @see {@link file://./user-user-role-helper.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createLayoutLoaderData } from "@factories";
import { isExplicitCheckoutRequired } from "~/modules/booking-settings/explicit-checkout";
import { useUserRoleHelper } from "./user-user-role-helper";

// why: the hook reads the `_layout` route's loader data, which needs a data
// router; the roles in that payload are the variable under test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useRouteLoaderData: vi.fn() };
});

/** The hook's result for a viewer holding `roles` (or no layout data). */
function helperFor(roles: OrganizationRoles[] | undefined) {
  vi.mocked(useRouteLoaderData).mockReturnValue(
    roles ? createLayoutLoaderData({ roles }) : undefined
  );
  return renderHook(() => useUserRoleHelper()).result.current;
}

describe("useUserRoleHelper — effectiveRole", () => {
  it.each([
    [[OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN], "ADMIN"],
    [[OrganizationRoles.ADMIN, OrganizationRoles.OWNER], "OWNER"],
    [[OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE], "SELF_SERVICE"],
    [[OrganizationRoles.BASE], "BASE"],
  ])("resolves %j to %s", (roles, expected) => {
    expect(helperFor(roles).effectiveRole).toBe(expected);
  });

  it("reads as BASE before the layout data exists, so no role rule applies", () => {
    expect(helperFor(undefined).effectiveRole).toBe(OrganizationRoles.BASE);
  });

  it("gives a [SELF_SERVICE, ADMIN] membership the admin's check-out rule", () => {
    // The booking page gates the one-click check-out on this role; the server
    // judges the same membership as an admin, so only the Admin switch counts.
    const { effectiveRole } = helperFor([
      OrganizationRoles.SELF_SERVICE,
      OrganizationRoles.ADMIN,
    ]);

    expect(
      isExplicitCheckoutRequired({
        role: effectiveRole,
        bookingSettings: {
          requireExplicitCheckoutForAdmin: false,
          requireExplicitCheckoutForSelfService: true,
        },
      })
    ).toBe(false);
  });
});
