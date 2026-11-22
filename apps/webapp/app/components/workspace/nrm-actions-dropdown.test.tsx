/**
 * TeamMembersActionsDropdown: per-item gating.
 *
 * Invite, Edit and Delete each show behind their own grant
 * (`teamMember:create`, `nonRegisteredMember:update`,
 * `nonRegisteredMember:delete`), and the whole menu is withheld only when the
 * caller holds none of the three. Pins that Invite is not bundled with Edit or
 * Delete: a caller with only the invite grant still gets a usable menu.
 *
 * @see {@link file://./nrm-actions-dropdown.tsx}
 * @see {@link file://./../../routes/_layout+/settings.team.nrm.tsx}
 */
import type { Prisma } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { TeamMembersActionsDropdown } from "./nrm-actions-dropdown";

// why: the component reads `isPersonalOrg` off the route loader; no router
// context is mounted so the real hook has nothing to read.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ isPersonalOrg: false }),
  };
});

// why: forces the menu content to render without simulating a click; the real
// hook reads search params through a router context we don't mount.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    open: true,
    setOpen: vi.fn(),
  }),
}));

// why: the invite dialog pulls in the current organization, a fetcher and
// role access of its own; this test only cares whether the menu item shows.
vi.mock("../settings/invite-user-dialog", () => ({
  default: () => null,
}));

/** Minimal fixture; `canDelete` is false in every case so `DeleteMember` never mounts. */
const teamMember = {
  id: "tm-1",
  _count: { custodies: 0, kitCustodies: 0 },
} as unknown as Prisma.TeamMemberGetPayload<{
  include: { _count: { select: { custodies: true; kitCustodies: true } } };
}>;

function renderMenu(props: {
  canInvite: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return render(
    <MemoryRouter>
      <TeamMembersActionsDropdown teamMember={teamMember} {...props} />
    </MemoryRouter>
  );
}

describe("TeamMembersActionsDropdown", () => {
  it("renders without an Invite user item when only Edit is granted", () => {
    renderMenu({ canInvite: false, canEdit: true, canDelete: false });

    expect(
      screen.getByRole("button", { name: /actions trigger/i })
    ).toBeTruthy();
    expect(screen.queryByText(/invite user/i)).toBeNull();
  });

  it("still renders the menu, with Invite user, when only Invite is granted", () => {
    renderMenu({ canInvite: true, canEdit: false, canDelete: false });

    expect(
      screen.getByRole("button", { name: /actions trigger/i })
    ).toBeTruthy();
    expect(screen.getByText(/invite user/i)).toBeTruthy();
  });

  it("renders nothing when the caller holds none of the three grants", () => {
    const { container } = renderMenu({
      canInvite: false,
      canEdit: false,
      canDelete: false,
    });

    expect(container).toBeEmptyDOMElement();
  });
});
