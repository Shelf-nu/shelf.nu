/**
 * BulkActionsDropdown: which items a selection enables, and why not.
 *
 * Delete is disabled for two unrelated causes: a request already in flight
 * (`isLoading`), or the caller's role being held to drafts-only deletion
 * (`roleAccess.policy.bookings.deleteOnlyDrafts`) on a selection that is not
 * all drafts. Only the second has a reason worth showing; a plain loading
 * state must disable the control without claiming the selection is invalid.
 *
 * Check out takes a selection of RESERVED bookings only and Check in a
 * selection of ONGOING or OVERDUE ones; both are disabled with a reason
 * otherwise, without the grant, and under the workspace's explicit scan
 * requirement for that direction. Both are also disabled when the selection,
 * a select-all counted at the list's total, is over the bulk cap.
 *
 * @see {@link file://./bulk-actions-dropdown.tsx}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { MAX_BULK_CHECK_IN_OUT_BOOKINGS } from "~/modules/booking/constants";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { ExplicitScanSettings } from "~/utils/permissions/role-access";
import BulkActionsDropdown from "./bulk-actions-dropdown";

// why: the component reads navigation state to know a request is in flight,
// and the list's total to size a select-all; no data router is mounted, so
// the real hooks have nothing to read.
let mockNavigationState: "idle" | "submitting" = "idle";
let mockTotalItems = 2;
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: mockNavigationState }),
    useLoaderData: () => ({ totalItems: mockTotalItems }),
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

/** The workspace's explicit scan switches, all off unless a test flips one. */
const NO_EXPLICIT_SCAN: ExplicitScanSettings = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: false,
  requireExplicitCheckinForAdmin: false,
  requireExplicitCheckinForSelfService: false,
};
let mockBookingSettings: ExplicitScanSettings = NO_EXPLICIT_SCAN;

// why: the explicit scan switches come off the `_layout` loader too.
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => mockBookingSettings,
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
    onOpenChange: vi.fn(),
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
vi.mock("./bulk-checkout-dialog", () => ({ default: () => null }));
vi.mock("./bulk-checkin-dialog", () => ({ default: () => null }));

const mockedUseOrganizationRoles = vi.mocked(useOrganizationRoles);

function setup({
  roles,
  bookings,
  isLoading = false,
  settings = NO_EXPLICIT_SCAN,
  totalItems = 2,
}: {
  roles: OrganizationRoles[];
  bookings: { id: string; status: BookingStatus }[];
  isLoading?: boolean;
  settings?: ExplicitScanSettings;
  /** The list's total, which a select-all stands for */
  totalItems?: number;
}) {
  mockedUseOrganizationRoles.mockReturnValue(roles);
  mockRoles = roles;
  mockSelectedBookings = bookings;
  mockNavigationState = isLoading ? "submitting" : "idle";
  mockBookingSettings = settings;
  mockTotalItems = totalItems;

  render(<BulkActionsDropdown />);
}

/** The trigger for one menu item; the dropdown renders each once. */
function item(name: RegExp) {
  const [button] = screen.getAllByRole("button", { name });
  return button;
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

describe("BulkActionsDropdown: bulk Check out", () => {
  const notReservedReason = /only check out reserved bookings/i;

  it("enables Check out for an ADMIN with an all-RESERVED selection", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [
        { id: "b1", status: BookingStatus.RESERVED },
        { id: "b2", status: BookingStatus.RESERVED },
      ],
    });

    expect(item(/^check out$/i)).toBeEnabled();
    expect(screen.queryByText(notReservedReason)).toBeNull();
  });

  it("leaves Check out to the server on a select-all, whose rows are not in the browser", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [
        { id: "b1", status: BookingStatus.RESERVED },
        { id: ALL_SELECTED_KEY, status: undefined as unknown as BookingStatus },
      ],
    });

    expect(item(/^check out$/i)).toBeEnabled();
  });

  it("disables Check out and Check in when a select-all stands for more bookings than the cap", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      // Only the sentinel, so neither status rule is in play: the cap alone
      // disables both items.
      bookings: [
        { id: ALL_SELECTED_KEY, status: undefined as unknown as BookingStatus },
      ],
      totalItems: MAX_BULK_CHECK_IN_OUT_BOOKINGS + 1,
    });

    expect(item(/^check out$/i)).toHaveAttribute("aria-disabled", "true");
    expect(item(/^check in$/i)).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getAllByText(
        new RegExp(`at most ${MAX_BULK_CHECK_IN_OUT_BOOKINGS} bookings at once`)
      ).length
    ).toBeGreaterThan(0);
  });

  it("disables Check out with the status reason when a draft is in the selection", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [
        { id: "b1", status: BookingStatus.RESERVED },
        { id: "b2", status: BookingStatus.DRAFT },
      ],
    });

    expect(item(/^check out$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(notReservedReason)).toBeTruthy();
  });

  it("disables Check out with the explicit-mode reason when the workspace requires it for the viewer", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [{ id: "b1", status: BookingStatus.RESERVED }],
      settings: { ...NO_EXPLICIT_SCAN, requireExplicitCheckoutForAdmin: true },
    });

    expect(item(/^check out$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/requires explicit check-out/i)).toBeTruthy();
  });

  it("disables Check out with the permission reason for a BASE viewer", () => {
    setup({
      roles: [OrganizationRoles.BASE],
      bookings: [{ id: "b1", status: BookingStatus.RESERVED }],
    });

    expect(item(/^check out$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/permission to check out bookings/i)).toBeTruthy();
  });
});

describe("BulkActionsDropdown: bulk Check in", () => {
  const notInProgressReason = /only check in ongoing or overdue bookings/i;

  it("enables Check in for an ONGOING and OVERDUE selection", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [
        { id: "b1", status: BookingStatus.ONGOING },
        { id: "b2", status: BookingStatus.OVERDUE },
      ],
    });

    expect(item(/^check in$/i)).toBeEnabled();
    expect(screen.queryByText(notInProgressReason)).toBeNull();
  });

  it("disables Check in with the status reason when a draft is in the selection", () => {
    setup({
      roles: [OrganizationRoles.ADMIN],
      bookings: [
        { id: "b1", status: BookingStatus.ONGOING },
        { id: "b2", status: BookingStatus.DRAFT },
      ],
    });

    expect(item(/^check in$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(notInProgressReason)).toBeTruthy();
  });

  it("disables Check in with the explicit-mode reason when the workspace requires it for the viewer", () => {
    setup({
      roles: [OrganizationRoles.SELF_SERVICE],
      bookings: [{ id: "b1", status: BookingStatus.ONGOING }],
      settings: {
        ...NO_EXPLICIT_SCAN,
        requireExplicitCheckinForSelfService: true,
      },
    });

    expect(item(/^check in$/i)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/requires explicit check-in/i)).toBeTruthy();
  });
});
