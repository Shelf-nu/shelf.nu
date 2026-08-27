/**
 * Role gating for {@link ListBulkActionsDropdown}.
 *
 * The menu is rendered behind `booking-assets-column`'s `canSeeActions`, which
 * asks only "is this user the custodian" — never "at this status, may they".
 * So a BASE custodian on their own ONGOING booking was shown "Check in
 * selected items" (403s: BASE has no `booking:checkin`) and "Remove
 * assets/kits" (SUCCEEDED, resetting those assets to available — the very
 * check-in the role is denied). Reported by a customer, Aug 2026.
 *
 * These tests pin the OUTER answer — whether the menu exists at all for a
 * given role and status. Which items it lists is derived from the same three
 * flags, and the removal rule itself is unit-tested in
 * `~/utils/bookings.test.ts`; asserting item text here would mean driving
 * Radix's open state for no extra coverage.
 *
 * Mocks:
 * - `react-router` — `useLoaderData` stubbed so booking status is per-test.
 * - `~/hooks/user-user-role-helper` — the role under test.
 * - `~/hooks/use-controlled-dropdown-menu` — reads search params / router.
 * - the three bulk dialogs and `BulkUpdateDialogTrigger` — each pulls its own
 *   form and atom chain; they render outside the menu and are not asserted.
 *
 * @see {@link file://./list-bulk-actions-dropdown.tsx}
 */

import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUserRoleHelper } from "~/hooks/user-user-role-helper";

import ListBulkActionsDropdown from "./list-bulk-actions-dropdown";

vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useLoaderData: vi.fn() };
});

vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: vi.fn(),
}));

// why: the real hook reads search params and a router context we don't mount.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    defaultApplied: true,
    open: false,
    defaultOpen: false,
    setOpen: vi.fn(),
  }),
}));

// why: `useHydrated` returns false on first render, which short-circuits to a
// placeholder button before any role logic runs.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

vi.mock("./bulk-remove-asset-and-kit-dialog", () => ({ default: () => null }));
vi.mock("./bulk-partial-checkin-dialog", () => ({ default: () => null }));
vi.mock("./bulk-partial-checkout-dialog", () => ({ default: () => null }));
vi.mock("../bulk-update-dialog/bulk-update-dialog", () => ({
  BulkUpdateDialogTrigger: () => null,
}));

const mockedUseLoaderData = vi.mocked(useLoaderData);
const mockedUseUserRoleHelper = vi.mocked(useUserRoleHelper);

function setup({
  status,
  roles,
}: {
  status: BookingStatus;
  roles: OrganizationRoles[];
}) {
  mockedUseLoaderData.mockReturnValue({
    booking: { id: "b1", status, bookingAssets: [] },
    partialCheckinDetails: {},
    checkedOutAssetIds: [],
    remainingToCheckOutByAsset: {},
  } as never);

  mockedUseUserRoleHelper.mockReturnValue({
    roles,
  } as ReturnType<typeof useUserRoleHelper>);

  render(<ListBulkActionsDropdown />);
}

/** The menu renders two triggers (desktop + mobile); presence is what matters. */
const menuIsRendered = () => screen.queryAllByText("Actions").length > 0;

describe("ListBulkActionsDropdown role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers nothing to a BASE custodian on a live booking", () => {
    setup({
      status: BookingStatus.ONGOING,
      roles: [OrganizationRoles.BASE],
    });

    expect(menuIsRendered()).toBe(false);
  });

  it("offers nothing to a BASE custodian once the booking is reserved", () => {
    setup({
      status: BookingStatus.RESERVED,
      roles: [OrganizationRoles.BASE],
    });

    expect(menuIsRendered()).toBe(false);
  });

  it("still lets a BASE custodian edit their DRAFT booking", () => {
    setup({ status: BookingStatus.DRAFT, roles: [OrganizationRoles.BASE] });

    expect(menuIsRendered()).toBe(true);
  });

  // SELF_SERVICE holds `booking:checkin` and `booking:checkout`, so the menu
  // must survive on a live booking — this fix must not cost them that.
  it("keeps the menu for SELF_SERVICE on a live booking", () => {
    setup({
      status: BookingStatus.ONGOING,
      roles: [OrganizationRoles.SELF_SERVICE],
    });

    expect(menuIsRendered()).toBe(true);
  });

  it("keeps the menu for ADMIN on a live booking", () => {
    setup({
      status: BookingStatus.ONGOING,
      roles: [OrganizationRoles.ADMIN],
    });

    expect(menuIsRendered()).toBe(true);
  });

  // Still visible for an admin, disabled with the closed-record reason.
  it("keeps the menu for ADMIN on a completed booking", () => {
    setup({
      status: BookingStatus.COMPLETE,
      roles: [OrganizationRoles.ADMIN],
    });

    expect(menuIsRendered()).toBe(true);
  });
});
