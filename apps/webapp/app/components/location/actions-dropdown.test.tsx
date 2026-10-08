/**
 * Location ActionsDropdown: each entry renders only for a member its route
 * accepts.
 *
 * Create audit needs `audit:create`, Edit `location:update` and Delete
 * `location:delete`. A Manager runs audits but does not edit locations, so it
 * sees Create audit alone; a member with none of the three gets no menu at all
 * rather than an Actions button that opens onto nothing.
 *
 * @see {@link file://./actions-dropdown.tsx}
 */
import type { ReactNode } from "react";
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionsDropdown } from "./actions-dropdown";

/** The roles the mocked `useOrganizationRoles` returns for the current case. */
let mockRoles: OrganizationRoles[] = [];

// why: the role under test. The real hook reads the `_layout` route loader,
// which is not mounted here.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => mockRoles,
}));

// why: the component renders a static placeholder until hydrated; the menu
// entries under test only exist past that point.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: forces the popover open without simulating a click; the real hook
// reads search params through a router context we don't mount.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    open: true,
    setOpen: vi.fn(),
  }),
}));

// why: the audit dialog loads team members and asset counts through fetchers;
// it stays closed in every case here, so a stub is enough.
vi.mock("~/components/audit/start-audit-from-context-dialog", () => ({
  StartAuditFromContextDialog: () => null,
}));

// why: the delete dialog submits through a route form; only its trigger is
// under test, so render the trigger alone.
vi.mock("./delete-location", () => ({
  DeleteLocation: ({ trigger }: { trigger: ReactNode }) => trigger,
}));

function renderMenu(roles: OrganizationRoles[]) {
  mockRoles = roles;
  return render(
    <MemoryRouter>
      <ActionsDropdown
        location={{ id: "location-1", name: "Warehouse", childCount: 0 }}
        assetCount={3}
      />
    </MemoryRouter>
  );
}

describe("location ActionsDropdown", () => {
  beforeEach(() => {
    mockRoles = [];
  });

  it("offers an Administrator every entry", () => {
    renderMenu([OrganizationRoles.ADMIN]);
    expect(screen.getByText("Create audit")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("offers a Manager Create audit but not Edit or Delete", () => {
    renderMenu([OrganizationRoles.MANAGER]);
    expect(screen.getByText("Create audit")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("renders no menu for a member who can use none of its entries", () => {
    renderMenu([OrganizationRoles.BASE]);
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByText("Create audit")).not.toBeInTheDocument();
  });
});
