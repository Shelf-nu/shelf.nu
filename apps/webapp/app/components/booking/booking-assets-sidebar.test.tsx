/**
 * Tests for the QT stock-availability badges (`InsufficientStockBadge` /
 * `PendingReturnBadge`) as wired into `BookingAssetsSidebar`. Mirrors the
 * equivalent coverage in `list-asset-content.test.tsx` — the two surfaces
 * share the same decision helper (`resolveQtyStockBadgeVariant`,
 * `~/utils/booking-assets`), but each computes `contextStatus` /
 * `effectiveStatus` independently, so a wiring bug in one would not be
 * caught by the other's tests.
 *
 * The sidebar renders inside a Radix `Sheet` (closed by default), so tests
 * open it first via the default trigger button.
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BookingAssetsSidebar } from "./booking-assets-sidebar";

// why: useCurrentOrganization calls useRouteLoaderData under the hood, which
// throws outside a router context. Returning null short-circuits the
// `resolveDisplayCode` call in `AssetTitleAndStatus` (guarded on truthiness)
// so the asset-code chip is simply skipped — irrelevant to these tests.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => null,
}));

// why: the real `Button` renders a react-router `Link` for `to=`, which
// requires a Router context this component-only render doesn't provide.
// A plain anchor keeps the DOM structure close enough for these tests
// (none of which assert on navigation).
vi.mock("~/components/shared/button", () => ({
  Button: ({
    children,
    onClick,
    type,
    ...rest
  }: {
    children: ReactNode;
    onClick?: () => void;
    type?: string;
    [key: string]: unknown;
  }) =>
    onClick ? (
      <button
        type={(type as "button" | "submit") ?? "button"}
        onClick={onClick}
        {...rest}
      >
        {children}
      </button>
    ) : (
      <a href="/test" {...rest}>
        {children}
      </a>
    ),
}));

// why: isolating the sidebar's own badge-wiring logic from the real status
// badge's rendering/tooltip internals, which have their own test coverage.
vi.mock("../assets/asset-status-badge", () => ({
  AssetStatusBadge: ({ status }: { status: string }) => (
    <div data-testid="asset-status-badge">{status}</div>
  ),
}));

// why: avoiding image-loading/fallback complexity during unit tests.
vi.mock("../assets/asset-image", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));

// why: category rendering is irrelevant to the stock-badge logic under test.
vi.mock("../assets/category-badge", () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));

// why: consumption-type pill is irrelevant to the stock-badge logic under test.
vi.mock("../assets/consumption-type-badge", () => ({
  ConsumptionTypeBadge: () => null,
}));

// why: avoiding native <img> loading/fallback complexity for kit rows.
vi.mock("../kits/kit-image", () => ({
  default: () => <div data-testid="kit-image" />,
}));

/** Minimal QT asset row satisfying `SidebarAssetBase` for these tests. */
function makeQtAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-boards",
    title: "Boards",
    type: "QUANTITY_TRACKED",
    consumptionType: null,
    availableToBook: true,
    custody: null,
    status: "AVAILABLE",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    sequentialId: null,
    preferredBarcodeId: null,
    qrCodes: [],
    barcodes: [],
    category: null,
    assetKits: [],
    ...overrides,
  };
}

/** Minimal booking with a single standalone QT booking-asset row. */
function makeBooking({
  status,
  asset,
  bookedQuantity,
}: {
  status: string;
  asset: ReturnType<typeof makeQtAsset>;
  bookedQuantity: number;
}) {
  return {
    id: "booking-1",
    name: "Test booking",
    status,
    bookingAssets: [
      { id: "ba-1", quantity: bookedQuantity, assetKitId: null, asset },
    ],
  } as unknown as Parameters<typeof BookingAssetsSidebar>[0]["booking"];
}

/** Opens the sidebar sheet via its default trigger and returns once settled. */
async function openSidebar() {
  const user = userEvent.setup();
  await user.click(screen.getByText(/assets?$/i));
}

describe("BookingAssetsSidebar QT stock badges", () => {
  it("renders the red InsufficientStockBadge when bookedQuantity exceeds bookable", async () => {
    const asset = makeQtAsset();
    const booking = makeBooking({
      status: "ONGOING",
      asset,
      bookedQuantity: 10,
    });

    render(
      <BookingAssetsSidebar
        booking={booking}
        availableUnitsByAsset={{
          [asset.id]: { bookable: 3, physicalNow: 3, reserved: 7 },
        }}
      />
    );

    await openSidebar();

    const trigger = await screen.findByText("Insufficient stock");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveClass("bg-red-50");
  });

  it("renders the amber PendingReturnBadge on a not-started booking when rowQty fits bookable but exceeds physicalNow, with an explanatory tooltip", async () => {
    // "Boards" real case: 10 total, 7 needed; 7 return before this RESERVED
    // booking's window opens (bookable=10) but only 3 are on the shelf
    // right now (physicalNow=3).
    const asset = makeQtAsset();
    const booking = makeBooking({
      status: "RESERVED",
      asset,
      bookedQuantity: 7,
    });

    render(
      <BookingAssetsSidebar
        booking={booking}
        availableUnitsByAsset={{
          [asset.id]: { bookable: 10, physicalNow: 3, reserved: 0 },
        }}
      />
    );

    await openSidebar();

    expect(screen.queryByText("Insufficient stock")).not.toBeInTheDocument();

    const trigger = await screen.findByText("Checked out elsewhere");
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveClass("bg-warning-50");

    await userEvent.hover(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(/7 units/);
    expect(tooltip.textContent).toMatch(/only 3/);
  });

  it("does NOT render any stock badge when bookedQuantity fits within physicalNow", async () => {
    const asset = makeQtAsset();
    const booking = makeBooking({
      status: "RESERVED",
      asset,
      bookedQuantity: 2,
    });

    render(
      <BookingAssetsSidebar
        booking={booking}
        availableUnitsByAsset={{
          [asset.id]: { bookable: 10, physicalNow: 5, reserved: 0 },
        }}
      />
    );

    await openSidebar();
    // Wait for the sheet content to be present via a stable element first.
    await screen.findByTestId("asset-status-badge");

    expect(screen.queryByText("Insufficient stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Checked out elsewhere")).not.toBeInTheDocument();
  });

  it("does NOT render any stock badge for an asset that is already CHECKED_OUT, even though bookedQuantity exceeds bookable", async () => {
    // Global asset.status CHECKED_OUT (quick-checkout, all-at-once path) —
    // `effectiveStatus` falls through to this raw status since none of the
    // sidebar's own qty-progress branches apply (no checkedOutByAsset /
    // dispositionedByAsset entries supplied).
    const asset = makeQtAsset({ status: "CHECKED_OUT" });
    const booking = makeBooking({
      status: "ONGOING",
      asset,
      bookedQuantity: 22,
    });

    render(
      <BookingAssetsSidebar
        booking={booking}
        availableUnitsByAsset={{
          [asset.id]: { bookable: 3, physicalNow: 3, reserved: 19 },
        }}
      />
    );

    await openSidebar();
    await screen.findByTestId("asset-status-badge");

    expect(screen.queryByText("Insufficient stock")).not.toBeInTheDocument();
    expect(screen.queryByText("Checked out elsewhere")).not.toBeInTheDocument();
  });
});
