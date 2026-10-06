/**
 * ActionsDropdown: the mobile Close button and status notices are outside
 * the `asset:update` group.
 *
 * A SELF_SERVICE member holds `asset:custody` but not `asset:update`, so most
 * of this menu is gated away. The mobile Close control and the "why some
 * actions are disabled" notices must still render for them: without a way to
 * dismiss the menu on mobile they would be stuck, and without the notice they
 * would have no explanation for a disabled custody action.
 *
 * @see {@link file://./actions-dropdown.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import ActionsDropdown from "./actions-dropdown";

// why: the component reads the asset straight off the route loader; there is
// no prop seam to inject it through.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    // `custodySources` is the layout loader's source summary for the Assign
    // and Adjust dialogs; an asset at one location (or none) has a single pool.
    useLoaderData: () => ({
      asset: mockAsset,
      custodySources: { multiSource: false, options: [], poolAvailable: 0 },
    }),
  };
});

// why: the default export renders a static placeholder until hydrated; the
// popover content under test only exists past that point.
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

// why: the role under test. The real hook reads the `_layout` route loader,
// which is not mounted here.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => [OrganizationRoles.SELF_SERVICE],
}));

// why: drives `assignsSelfOnly`; the real hook reads the `_layout` loader.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ custody: { assign: "self" } }),
}));

// why: the real hook reads the root loader; a fixed id is enough to compute
// "assigned to me" without mounting a router.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: the real dialog pulls in the QR/barcode scanner, which touches canvas
// APIs Happy DOM does not implement; the dialog stays closed in every case
// here, so a stub is enough.
vi.mock("./relink-qr-code-dialog", () => ({ default: () => null }));

/** A bookable, INDIVIDUAL asset with no custody and no kit membership. */
let mockAsset: Record<string, unknown> = {};

const baseAsset = {
  id: "asset-1",
  type: "INDIVIDUAL",
  status: "AVAILABLE",
  quantity: null,
  unitOfMeasure: null,
  custody: [],
  assetKits: [],
  qrCodes: [],
};

function renderMenu(overrides: Partial<typeof baseAsset> = {}) {
  mockAsset = { ...baseAsset, ...overrides };
  return render(
    <MemoryRouter>
      <ActionsDropdown />
    </MemoryRouter>
  );
}

describe("ActionsDropdown: custody-only caller (SELF_SERVICE)", () => {
  it("opens the menu and offers the mobile Close button", () => {
    renderMenu();

    expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
    expect(
      screen.queryByText(
        /some actions are disabled due to the asset being checked out/i
      )
    ).toBeNull();
  });

  it("also shows the checked-out notice when the asset is checked out", () => {
    renderMenu({ status: "CHECKED_OUT" });

    expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
    expect(
      screen.getByText(
        /some actions are disabled due to the asset being checked out/i
      )
    ).toBeTruthy();
  });
});
