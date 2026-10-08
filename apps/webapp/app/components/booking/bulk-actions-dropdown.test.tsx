/**
 * BulkActionsDropdown: loading must not borrow the drafts-only reason.
 *
 * Delete is disabled for two unrelated causes: a request already in flight
 * (`isLoading`), or the caller's role being held to drafts-only deletion
 * (`roleAccess.policy.bookings.deleteOnlyDrafts`) on a selection that is not
 * all drafts. Only the second has a reason worth showing; a plain loading
 * state must disable the control without claiming the selection is invalid.
 *
 * @see {@link file://./bulk-actions-dropdown.tsx}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import BulkActionsDropdown from "./bulk-actions-dropdown";

// why: the component reads navigation state to know a request is in flight;
// no data router is mounted, so the real hook has nothing to read.
let mockNavigationState: "idle" | "submitting" = "idle";
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: mockNavigationState }),
  };
});

// why: the role under test. The real hook reads the `_layout` route loader,
// which is not mounted here.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: vi.fn(),
}));

/** The roles the organization-roles mock returns; the access mock reads the same. */
let mockRoles: OrganizationRoles[] = [];

// why: the drafts-only flag comes from the member's resolved access, read off
// the `_layout` loader in real code; drive it from the same roles instead.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => accessFor(mockRoles),
}));

/** The selection the mocked `useAtomValue` returns. */
let mockSelectedBookings: { id: string; status: BookingStatus }[] = [];

// why: the selection lives in a jotai atom whose `onMount` resets it at
// subscription time, so a seeded selection would be wiped before render.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("jotai");
  return { ...actual, useAtomValue: () => mockSelectedBookings };
});

// why: forces the menu content to render without simulating a click; the
// real hook reads search params through a router context we don't mount.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    defaultApplied: true,
    open: true,
    defaultOpen: false,
    setOpen: vi.fn(),
  }),
}));

// why: `useHydrated` returns false on first render, which short-circuits to a
// placeholder button before any role logic runs.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: these dialogs open in their own portal and pull the booking index
// loader data; nothing here asserts on them, only on the trigger row.
vi.mock("./bulk-delete-dialog", () => ({ default: () => null }));
vi.mock("./bulk-archive-dialog", () => ({ default: () => null }));
vi.mock("./bulk-cancel-dialog", () => ({ default: () => null }));

const mockedUseOrganizationRoles = vi.mocked(useOrganizationRoles);

function setup({
  roles,
  bookings,
  isLoading,
}: {
  roles: OrganizationRoles[];
  bookings: { id: string; status: BookingStatus }[];
  isLoading: boolean;
}) {
  mockedUseOrganizationRoles.mockReturnValue(roles);
  mockRoles = roles;
  mockSelectedBookings = bookings;
  mockNavigationState = isLoading ? "submitting" : "idle";

  render(<BulkActionsDropdown />);
}

const draftsOnlyReason = /not in draft or you have self user permissions/i;

describe("BulkActionsDropdown: Delete while a request is in flight", () => {
  it("disables Delete for an ADMIN with an all-draft selection, without the drafts-only reason", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [{ id: "b1", status: BookingStatus.DRAFT }],
      isLoading: true,
    });

    const [deleteButton] = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButton).toBeDisabled();
    expect(screen.queryByText(draftsOnlyReason)).toBeNull();
  });

  it("still gives the drafts-only reason for a SELF_SERVICE caller on a non-draft selection", () => {
    setup({
      roles: [OrganizationRoles.SELF_SERVICE],
      bookings: [{ id: "b1", status: BookingStatus.RESERVED }],
      isLoading: true,
    });

    const [deleteButton] = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(draftsOnlyReason)).toBeTruthy();
  });
});
