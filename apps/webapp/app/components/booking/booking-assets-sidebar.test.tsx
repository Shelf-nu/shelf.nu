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
 * open it first via the default trigger button. Its rows arrive from
 * `/api/bookings/:bookingId/assets-sidebar` rather than from props, so the
 * `useFetcher` mock below is how each case supplies them — and the second
 * suite covers that loading contract itself.
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * The fetcher the component sees. Reassigned per test so each case can pick a
 * state (in-flight / settled payload / settled error) without a router.
 */
let fetcher: {
  load: ReturnType<typeof vi.fn>;
  state: "idle" | "loading" | "submitting";
  data: unknown;
};

// why: the drawer no longer receives its rows as props — it loads them from
// `/api/bookings/:bookingId/assets-sidebar` when the sheet opens. Mocking
// `useFetcher` is what lets these tests supply that payload. Spread the real
// module so `Link` and friends keep working.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    // Read lazily: `fetcher` is assigned in `beforeEach`, long after this
    // factory is hoisted and run.
    useFetcher: () => fetcher,
  };
});

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

/**
 * Minimal list row: a count and a status, which is all the drawer trigger
 * needs. The asset rows themselves arrive from the fetcher.
 */
function makeBooking({
  status,
  assetCount = 1,
}: {
  status: string;
  assetCount?: number;
}) {
  return {
    id: "booking-1",
    name: "Test booking",
    status,
    _count: { bookingAssets: assetCount },
  } as unknown as Parameters<typeof BookingAssetsSidebar>[0]["booking"];
}

/** The settled resource-route payload for a single standalone QT row. */
function makePayload({
  asset,
  bookedQuantity,
}: {
  asset: ReturnType<typeof makeQtAsset>;
  bookedQuantity: number;
}) {
  return {
    bookingAssets: [
      { id: "ba-1", quantity: bookedQuantity, assetKitId: null, asset },
    ],
    dispositionedByAsset: {},
    dispositionBreakdownByAsset: {},
    checkedOutByAsset: {},
  };
}

/** Opens the sidebar sheet via its default trigger and returns once settled. */
async function openSidebar() {
  const user = userEvent.setup();
  await user.click(screen.getByText(/assets?$/i));
}

beforeEach(() => {
  fetcher = { load: vi.fn(), state: "idle", data: undefined };
});

describe("BookingAssetsSidebar QT stock badges", () => {
  it("renders the red InsufficientStockBadge when bookedQuantity exceeds bookable", async () => {
    const asset = makeQtAsset();
    const booking = makeBooking({ status: "ONGOING" });
    fetcher.data = makePayload({ asset, bookedQuantity: 10 });

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
    const booking = makeBooking({ status: "RESERVED" });
    fetcher.data = makePayload({ asset, bookedQuantity: 7 });

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
    const booking = makeBooking({ status: "RESERVED" });
    fetcher.data = makePayload({ asset, bookedQuantity: 2 });

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
    const booking = makeBooking({ status: "ONGOING" });
    fetcher.data = makePayload({ asset, bookedQuantity: 22 });

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

describe("BookingAssetsSidebar lazy loading", () => {
  it("fetches this booking's payload when the sheet opens", async () => {
    render(
      <BookingAssetsSidebar booking={makeBooking({ status: "RESERVED" })} />
    );

    expect(fetcher.load).not.toHaveBeenCalled();

    await openSidebar();

    expect(fetcher.load).toHaveBeenCalledTimes(1);
    expect(fetcher.load).toHaveBeenCalledWith(
      "/api/bookings/booking-1/assets-sidebar"
    );
  });

  it("does not stack a second request while one is in flight", async () => {
    fetcher.state = "loading";

    render(
      <BookingAssetsSidebar booking={makeBooking({ status: "RESERVED" })} />
    );
    await openSidebar();

    expect(fetcher.load).not.toHaveBeenCalled();
  });

  it("shows a spinner until the payload lands", async () => {
    render(
      <BookingAssetsSidebar booking={makeBooking({ status: "RESERVED" })} />
    );
    await openSidebar();

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("asset-status-badge")).not.toBeInTheDocument();
  });

  it("offers a retry instead of spinning forever when the fetch fails", async () => {
    // The fetch is only retried on a user action, so a settled error has to
    // replace the spinner or the drawer spins until the page is reloaded.
    fetcher.data = { error: { message: "Booking not found." } };

    render(
      <BookingAssetsSidebar booking={makeBooking({ status: "RESERVED" })} />
    );
    await openSidebar();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: /try again/i });

    fetcher.load.mockClear();
    await userEvent.click(retry);

    expect(fetcher.load).toHaveBeenCalledTimes(1);
    expect(fetcher.load).toHaveBeenCalledWith(
      "/api/bookings/booking-1/assets-sidebar"
    );
  });

  it("counts assets from the list row, not from the fetched payload", () => {
    // The count revalidates with every navigation; a payload fetched on an
    // earlier open can be stale, and before the first open there is none.
    const booking = makeBooking({ status: "RESERVED", assetCount: 12 });

    render(<BookingAssetsSidebar booking={booking} />);

    expect(screen.getByText("12 assets")).toBeInTheDocument();
  });

  it("does not open, or fetch, for a booking with nothing in it", async () => {
    const booking = makeBooking({ status: "RESERVED", assetCount: 0 });

    render(<BookingAssetsSidebar booking={booking} />);
    await openSidebar();

    expect(fetcher.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
