/**
 * ActionsDropdown, the kit page's actions menu: which kit edits a member is
 * offered.
 *
 * A Manager edits the kit (Edit, Update location, Relink QR Code) only while
 * the owner has turned on "Managers can edit assets", and never sees Delete:
 * the switch adds `kit:update`, not `kit:delete`. An Administrator sees Delete.
 *
 * @see {@link file://./actions-dropdown.tsx}
 * @see {@link file://./../../../../../packages/permissions/src/workspace-grants.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRoles } from "~/utils/permissions/member-roles";
import { withWorkspaceGrants } from "~/utils/permissions/member-roles";
import ActionsDropdown from "./actions-dropdown";

/** The roles `useOrganizationRoles` hands the menu for the current render. */
const caller = vi.hoisted(() => ({
  roles: undefined as MemberRoles | undefined,
}));

/** An available kit with one available asset, as the kit page loader returns it. */
const KIT = {
  id: "kit-1",
  name: "Camera kit",
  status: "AVAILABLE",
  custody: null,
  qrCodes: [{ id: "qr-1" }],
  assetKits: [{ asset: { type: "INDIVIDUAL", status: "AVAILABLE" } }],
};

// why: the menu reads the kit off the route loader, and the Delete dialog reads
// the navigation state through `useDisabled`; both need a data router. The
// rest of react-router stays real so the link items render in a MemoryRouter.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ kit: KIT, archivedMemberCount: 0 }),
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: the default export renders a static placeholder until hydrated; the
// menu content under test only exists past that point.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: forces the menu open without simulating a click; the real hook reads
// search params through a router context that is not mounted.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    open: true,
    defaultOpen: true,
    setOpen: vi.fn(),
    onOpenChange: vi.fn(),
  }),
}));

// why: the role under test. The real hook reads the `_layout` route loader,
// which is not mounted here.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => caller.roles,
}));

// why: the custody label and the self-service release rule read the `_layout`
// loader's access and the root loader's user; neither is under test.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ custody: { assign: "anyone" } }),
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: the audit and relink dialogs bring their own fetchers, loaders and the
// QR scanner, and only open on a click these cases never make.
vi.mock("~/components/audit/start-audit-from-context-dialog", () => ({
  StartAuditFromContextDialog: () => null,
}));
vi.mock("./relink-qr-code-dialog", () => ({ default: () => null }));

/** Renders the kit menu, open. */
function renderMenu() {
  render(
    <MemoryRouter>
      <ActionsDropdown />
    </MemoryRouter>
  );
}

describe('kit ActionsDropdown: kit edits under "Managers can edit assets"', () => {
  beforeEach(() => {
    caller.roles = undefined;
  });

  it("offers a Manager Edit and Update location but not Delete once the switch is on", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.MANAGER], {
      managersCanEditAssets: true,
    });

    renderMenu();

    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/edit"
    );
    expect(
      screen.getByRole("link", { name: "Update location" })
    ).toHaveAttribute("href", "/assets/update-location");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("offers a Manager neither Edit nor Update location while the switch is off", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.MANAGER], {
      managersCanEditAssets: false,
    });

    renderMenu();

    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Update location" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("offers an Administrator Delete", () => {
    caller.roles = withWorkspaceGrants([OrganizationRoles.ADMIN], {
      managersCanEditAssets: true,
    });

    renderMenu();

    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});
