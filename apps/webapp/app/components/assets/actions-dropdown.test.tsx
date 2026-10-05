/**
 * The asset page's actions menu disables "Assign custody" for an individually
 * tracked kit member and says why.
 *
 * Custody of a kit member comes from its kit. The server refuses the request
 * (`assertNotKitMembers`); the menu says so before the click. A
 * quantity-tracked asset in a kit keeps its quantity custody action, because
 * the units outside every kit can still be handed over on their own.
 *
 * @see {@link file://./actions-dropdown.tsx}
 * @see {@link file://./../../modules/asset/utils.ts} isIndividualKitMember
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActionsDropdown from "./actions-dropdown";

const useLoaderDataMock = vi.hoisted(() => vi.fn());

// why: the menu reads the asset straight off the route loader; there is no
// prop seam to inject it through. The rest of react-router stays real so the
// link-style menu items can render inside a MemoryRouter.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useLoaderData: useLoaderDataMock };
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
    setOpen: vi.fn(),
  }),
}));

// why: the role helper and the user both read the `_layout` route loader,
// which is not mounted here. An admin sees every item.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({
    roles: ["ADMIN"],
    isSelfService: false,
    isAdministratorOrOwner: true,
  }),
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: these items and dialogs each bring their own fetchers and loaders, and
// nothing here asserts on them.
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

/** An available asset as the asset page loader returns it. */
function asset(overrides: Record<string, unknown>) {
  return {
    id: "asset-1",
    title: "Tripod",
    status: "AVAILABLE",
    type: "INDIVIDUAL",
    quantity: null,
    unitOfMeasure: null,
    custody: [],
    assetKits: [],
    qrCodes: [],
    ...overrides,
  };
}

const IN_CAMERA_KIT = [
  { kit: { id: "kit-camera", name: "Camera Kit", status: "AVAILABLE" } },
];

function renderMenu(loadedAsset: Record<string, unknown>) {
  useLoaderDataMock.mockReturnValue({ asset: loadedAsset });
  render(
    <MemoryRouter>
      <ActionsDropdown />
    </MemoryRouter>
  );
}

describe("asset page actions menu: custody of kit members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Assign custody for an individually tracked kit member, naming the kit", () => {
    renderMenu(asset({ assetKits: IN_CAMERA_KIT }));

    const item = screen.getByRole("link", { name: /assign custody/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      'This asset is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.'
    );
  });

  it("keeps Assign custody enabled for an asset in no kit", () => {
    renderMenu(asset({}));

    const item = screen.getByRole("link", { name: /assign custody/i });
    expect(item).not.toHaveAttribute("aria-disabled");
    expect(item).toHaveAttribute("href", "/overview/assign-custody");
  });

  it("keeps the quantity custody action enabled for a quantity-tracked asset in a kit", () => {
    renderMenu(
      asset({
        type: "QUANTITY_TRACKED",
        quantity: 10,
        assetKits: IN_CAMERA_KIT,
      })
    );

    const item = screen.getByRole("button", { name: /assign custody/i });
    expect(item).toBeEnabled();
    expect(item).not.toHaveAttribute("aria-disabled");
  });

  it("still disables Update location for a kit member, pointing at the kit", () => {
    renderMenu(asset({ assetKits: IN_CAMERA_KIT }));

    const item = screen.getByRole("link", { name: /update location/i });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleDescription(
      /location is managed by its parent kit/i
    );
  });
});
