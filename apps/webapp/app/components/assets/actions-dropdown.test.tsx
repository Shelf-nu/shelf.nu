/**
 * ActionsDropdown, the asset page's actions menu.
 *
 * Two behaviours are pinned here:
 *
 * - The mobile Close button and status notices sit outside the `asset:update`
 *   group. A SELF_SERVICE member holds `asset:custody` but not `asset:update`,
 *   so most of the menu is gated away; without a way to dismiss it on mobile
 *   they would be stuck, and without the notice they would have no
 *   explanation for a disabled custody action.
 * - "Assign custody" is disabled for an individually tracked kit member, with
 *   the reason. Custody of a kit member comes from its kit; the server refuses
 *   the request (`assertNotKitMembers`) and the menu says so before the click.
 *   A quantity-tracked asset in a kit keeps its quantity custody action,
 *   because the units outside every kit can still be handed over on their own.
 *
 * @see {@link file://./actions-dropdown.tsx}
 * @see {@link file://./../../modules/asset/utils.ts} isIndividualKitMember
 */
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionsDropdown from "./actions-dropdown";

/** The caller each suite renders as: roles for the matrix, access for reach. */
const caller = vi.hoisted(() => ({
  roles: [] as string[],
  assign: "anyone" as "anyone" | "self" | "none",
}));

/** The asset the route loader returns for the current render. */
let mockAsset: Record<string, unknown> = {};

// why: the component reads the asset straight off the route loader; there is
// no prop seam to inject it through. The rest of react-router stays real so
// the link-style menu items can render inside a MemoryRouter.
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
    // why: the Archive / Reinstate item posts through a fetcher, which needs a
    // data router; these tests never submit it, so an idle stub is enough.
    useFetcher: () => ({ state: "idle", submit: vi.fn() }),
    // why: `useDisabled` reads the navigation state alongside the fetcher's;
    // nothing is navigating in these tests.
    useNavigation: () => ({ state: "idle" }),
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
  useOrganizationRoles: () => caller.roles,
}));

// why: drives `assignsSelfOnly`; the real hook reads the `_layout` loader.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ custody: { assign: caller.assign } }),
}));

// why: the real hook reads the root loader; a fixed id is enough to compute
// "assigned to me" without mounting a router.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: these items and dialogs each bring their own fetchers and loaders, and
// nothing here asserts on them. The relink dialog also pulls in the QR/barcode
// scanner, which touches canvas APIs Happy DOM does not implement.
vi.mock("./delete-asset", () => ({ DeleteAsset: () => null }));
vi.mock("./update-gps-coordinates-form", () => ({
  UpdateGpsCoordinatesForm: () => null,
}));
vi.mock("./quantity-custody-dialog", () => ({
  QuantityCustodyDialog: () => null,
}));
vi.mock("./quick-adjust-dialog", () => ({ QuickAdjustDialog: () => null }));
vi.mock("./relink-qr-code-dialog", () => ({ default: () => null }));
vi.mock("../asset-reminder/set-or-edit-reminder-dialog", () => ({
  default: () => null,
}));

/** A bookable, INDIVIDUAL asset with no custody and no kit membership. */
const baseAsset = {
  id: "asset-1",
  title: "Tripod",
  type: "INDIVIDUAL",
  status: "AVAILABLE",
  quantity: null as number | null,
  unitOfMeasure: null,
  custody: [],
  assetKits: [] as unknown[],
  qrCodes: [],
};

const IN_CAMERA_KIT = [
  { kit: { id: "kit-camera", name: "Camera Kit", status: "AVAILABLE" } },
];

function renderMenu(overrides: Partial<typeof baseAsset> = {}) {
  mockAsset = { ...baseAsset, ...overrides };
  return render(
    <MemoryRouter>
      <ActionsDropdown />
    </MemoryRouter>
  );
}

describe("ActionsDropdown: custody-only caller (SELF_SERVICE)", () => {
  beforeEach(() => {
    caller.roles = [OrganizationRoles.SELF_SERVICE];
    caller.assign = "self";
  });

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

describe("ActionsDropdown: custody of kit members", () => {
  beforeEach(() => {
    // An admin sees every item.
    caller.roles = [OrganizationRoles.ADMIN];
    caller.assign = "anyone";
  });

  it("disables Assign custody for an individually tracked kit member, naming the kit", () => {
    renderMenu({ assetKits: IN_CAMERA_KIT });

    const item = screen.getByRole("link", { name: /assign custody/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      'This asset is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.'
    );
  });

  it("keeps Assign custody enabled for an asset in no kit", () => {
    renderMenu();

    const item = screen.getByRole("link", { name: /assign custody/i });
    expect(item).not.toHaveAttribute("aria-disabled");
    expect(item).toHaveAttribute("href", "/overview/assign-custody");
  });

  it("keeps the quantity custody action enabled for a quantity-tracked asset in a kit", () => {
    renderMenu({
      type: "QUANTITY_TRACKED",
      quantity: 10,
      assetKits: IN_CAMERA_KIT,
    });

    const item = screen.getByRole("button", { name: /assign custody/i });
    expect(item).toBeEnabled();
    expect(item).not.toHaveAttribute("aria-disabled");
  });

  it("still disables Update location for a kit member, pointing at the kit", () => {
    renderMenu({ assetKits: IN_CAMERA_KIT });

    const item = screen.getByRole("link", { name: /update location/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      /location is managed by its parent kit/i
    );
  });
});
