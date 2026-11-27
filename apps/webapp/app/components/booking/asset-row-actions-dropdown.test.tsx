/**
 * Tests for the "Adjust quantity" row action gate in
 * {@link AssetRowActionsDropdown}: it is offered, and auto-opened from
 * `?adjustQty=<assetId>`, only where `canManageBookingItems` lets the viewer
 * change the booking's items in its status, the rule the adjust route
 * enforces.
 *
 * @see {@link file://./asset-row-actions-dropdown.tsx}
 */

import type * as ReactModule from "react";
import type { ReactNode } from "react";
import type { Asset } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { accessFor } from "@helpers/role-access";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { AssetRowActionsDropdown } from "./asset-row-actions-dropdown";

const mocks = vi.hoisted(() => ({
  booking: { id: "booking-1", status: "ONGOING" },
  access: undefined as unknown,
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  load: vi.fn(),
}));

// why: the row reads its booking from the overview loader and loads the From
// section through a fetcher; neither has a data router here.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ booking: mocks.booking }),
    useFetcher: () => ({ state: "idle", data: undefined, load: mocks.load }),
  };
});

// why: the menu renders a static trigger until hydration; tests run hydrated.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: the viewer's role reach is the input under test.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => mocks.access,
}));

// why: `?adjustQty=` is read from the URL; the setter is asserted.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

// why: Radix Popover portals and manages focus; a shell that shows the
// content while `open` keeps the test on which items the menu offers.
vi.mock("@radix-ui/react-popover", async () => {
  const react = await vi.importActual<typeof ReactModule>("react");
  const OpenContext = react.createContext(false);
  const Popover = ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => <OpenContext.Provider value={open}>{children}</OpenContext.Provider>;
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>;
  const PopoverContent = react.forwardRef<
    HTMLDivElement,
    { children: ReactNode }
  >(({ children }, ref) =>
    react.useContext(OpenContext) ? <div ref={ref}>{children}</div> : null
  );
  PopoverContent.displayName = "PopoverContent";
  return {
    Popover,
    PopoverTrigger: Pass,
    PopoverPortal: Pass,
    PopoverContent,
  };
});

// why: the dialog has its own suite; here only whether it opens matters.
vi.mock("./adjust-booking-asset-quantity-dialog", () => ({
  AdjustBookingAssetQuantityDialog: ({ open }: { open: boolean }) =>
    open ? <div>Adjust dialog</div> : null,
}));

// why: the remove action has its own suite and pulls a form + fetcher.
vi.mock("./remove-asset-from-booking", () => ({
  RemoveAssetFromBooking: ({ trigger }: { trigger: ReactNode }) => (
    <>{trigger}</>
  ),
}));

const POOL = {
  id: "asset-1",
  title: "Chairs",
  type: "QUANTITY_TRACKED",
  quantity: 10,
  bookedQuantity: 2,
  unitOfMeasure: null,
} as unknown as Asset & { bookedQuantity: number };

/** Renders the row and opens its menu through the mobile trigger. */
function renderAndOpenMenu() {
  render(<AssetRowActionsDropdown asset={POOL} />);
  const triggers = screen.getAllByRole("button", { name: "Actions Trigger" });
  // The mobile trigger only ever opens the menu.
  fireEvent.click(triggers[triggers.length - 1]);
}

function setViewer(roles: OrganizationRoles[], status: string) {
  mocks.access = accessFor(roles) satisfies RoleAccess;
  mocks.booking = { id: "booking-1", status };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
});

describe("AssetRowActionsDropdown: Adjust quantity gate", () => {
  it("hides Adjust quantity from SELF_SERVICE on an ongoing booking", () => {
    setViewer([OrganizationRoles.SELF_SERVICE], "ONGOING");
    renderAndOpenMenu();

    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.queryByText("Adjust quantity")).not.toBeInTheDocument();
  });

  it("hides Adjust quantity from BASE on an ongoing booking", () => {
    setViewer([OrganizationRoles.BASE], "ONGOING");
    renderAndOpenMenu();

    expect(screen.queryByText("Adjust quantity")).not.toBeInTheDocument();
  });

  it("does not auto-open the dialog for SELF_SERVICE on an ongoing booking", () => {
    setViewer([OrganizationRoles.SELF_SERVICE], "ONGOING");
    mocks.searchParams = new URLSearchParams("adjustQty=asset-1");

    render(<AssetRowActionsDropdown asset={POOL} />);

    expect(screen.queryByText("Adjust dialog")).not.toBeInTheDocument();
    expect(mocks.setSearchParams).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("offers Adjust quantity to SELF_SERVICE on a draft", () => {
    setViewer([OrganizationRoles.SELF_SERVICE], "DRAFT");
    renderAndOpenMenu();

    expect(screen.getByText("Adjust quantity")).toBeInTheDocument();
  });

  it("offers Adjust quantity to ADMIN on an ongoing booking", () => {
    setViewer([OrganizationRoles.ADMIN], "ONGOING");
    renderAndOpenMenu();

    fireEvent.click(screen.getByText("Adjust quantity"));

    expect(screen.getByText("Adjust dialog")).toBeInTheDocument();
    // Opening the dialog loads its From section.
    expect(mocks.load).toHaveBeenCalledWith(
      "/api/bookings/booking-1/adjust-asset-quantity?assetId=asset-1"
    );
  });

  it("auto-opens the dialog for ADMIN from ?adjustQty", () => {
    setViewer([OrganizationRoles.ADMIN], "ONGOING");
    mocks.searchParams = new URLSearchParams("adjustQty=asset-1");

    render(<AssetRowActionsDropdown asset={POOL} />);

    expect(screen.getByText("Adjust dialog")).toBeInTheDocument();
    expect(mocks.setSearchParams).toHaveBeenCalledTimes(1);
  });
});
