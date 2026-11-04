/**
 * The kits index bulk menu: what a Manager may change in bulk.
 *
 * "Managers can edit assets" adds `kit: update` to a Manager, which opens
 * bulk location (`api+/kits.bulk-actions.ts`, `bulk-update-location`). Bulk
 * delete is `kit: delete`, a grant the switch never adds, so it stays with
 * Administrators.
 *
 * @see {@link file://./bulk-actions-dropdown.tsx}
 * @see {@link file://./../../../../../packages/permissions/src/workspace-grants.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRoles } from "~/utils/permissions/member-roles";
import { withWorkspaceGrants } from "~/utils/permissions/member-roles";
import BulkActionsDropdown from "./bulk-actions-dropdown";

/** The roles `useOrganizationRoles` hands the menu for the current render. */
const caller = vi.hoisted(() => ({
  roles: undefined as MemberRoles | undefined,
}));

// why: the selection lives in a jotai atom whose `onMount` resets it at
// subscription time, so a seeded selection would be wiped before render.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("jotai");
  return {
    ...actual,
    useAtomValue: () => [{ id: "kit-1", status: "AVAILABLE", assets: [] }],
  };
});

// why: the menu reads navigation state to disable items mid-submit; idle here.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useNavigation: () => ({ state: "idle" }) };
});

// why: `useHydrated` is false on the first render, which renders a placeholder
// button instead of the menu.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: the menu's open state comes from this hook, which reads search params;
// forcing it open renders the items the tests read.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    open: true,
    defaultOpen: true,
    setOpen: vi.fn(),
    onOpenChange: vi.fn(),
  }),
}));

// why: the roles, the role access and the user all read the `_layout` route
// loader, which is not mounted here. The roles carry the workspace's switches
// the way the real hook hands them out.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => caller.roles,
}));
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ custody: { assign: "anyone" } }),
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: every dialog brings its own form, loader and atom chain, renders
// outside the menu, and is not under test.
vi.mock("./bulk-assign-custody-dialog", () => ({ default: () => null }));
vi.mock("./bulk-delete-dialog", () => ({ default: () => null }));
vi.mock("./bulk-location-update-dialog", () => ({ default: () => null }));
vi.mock("./bulk-release-custody-dialog", () => ({ default: () => null }));
vi.mock("./bulk-start-audit-dialog", () => ({ default: () => null }));

/** Whether the open menu shows each of the two items the switch decides. */
function shownItems() {
  return ["Update location", "Delete"].filter(
    (name) => screen.queryByRole("button", { name }) !== null
  );
}

describe("kits index bulk menu: what a Manager may change in bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a Manager Update location but not Delete once the switch is on", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.MANAGER], {
      managersCanEditAssets: true,
    });

    render(<BulkActionsDropdown />);

    expect(shownItems()).toEqual(["Update location"]);
  });

  it("shows a Manager neither while the switch is off", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.MANAGER], {
      managersCanEditAssets: false,
    });

    render(<BulkActionsDropdown />);

    expect(shownItems()).toEqual([]);
  });

  it("shows an Administrator both", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.ADMIN], {
      managersCanEditAssets: false,
    });

    render(<BulkActionsDropdown />);

    expect(shownItems()).toEqual(["Update location", "Delete"]);
  });
});
