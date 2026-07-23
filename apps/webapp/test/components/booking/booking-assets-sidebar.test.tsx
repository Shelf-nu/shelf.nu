/**
 * BookingAssetsSidebar — dual-mode (eager vs lazy) unit tests
 *
 * The sidebar sources its rows two ways (see the component's file-level
 * doc): callers that ship `booking.bookingAssets` inline render eagerly
 * with zero fetching, while the bookings index omits the payload and the
 * sheet lazily fetches `/api/bookings/:bookingId/assets-sidebar` on open.
 * These tests pin the observable contract of both modes:
 *
 *  - Eager: rows render straight from the prop, no fetcher traffic.
 *  - Lazy: exactly one fetch per open, spinner while in flight, rows
 *    once the payload lands.
 *  - Lazy reopen: rows never duplicate; the previous payload renders
 *    immediately (no spinner flash) while the deliberate freshness
 *    re-fetch fires in the background.
 *  - Trigger state: a booking with zero concrete assets but outstanding
 *    model reservations is still openable (Book-by-Model), while a
 *    booking with nothing to show keeps an inert trigger.
 *
 * @see {@link file://./../../../app/components/booking/booking-assets-sidebar.tsx}
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.assets-sidebar.ts}
 */

import type { ComponentProps, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BookingAssetsSidebar,
  type DispositionBreakdown,
  type SidebarBookingAssets,
  type SidebarModelRequest,
} from "~/components/booking/booking-assets-sidebar";

/**
 * Shape of a successful `/api/bookings/:bookingId/assets-sidebar` response
 * as seen through `fetcher.data`. Mirrors `payload()` in the resource
 * route (`{ error: null, ...data }`), typed off the component's own
 * exports so the mock payload stays structurally in sync with what the
 * sidebar actually consumes.
 */
type AssetsSidebarPayload = {
  error: null;
  bookingAssets: SidebarBookingAssets;
  dispositionedByAsset: Record<string, number>;
  dispositionBreakdownByAsset: Record<string, DispositionBreakdown>;
  checkedOutByAsset: Record<string, number>;
};

/**
 * Settled error payload, as produced by the resource route's catch
 * (`data(error(reason), { status })`) — `error` is the only key the
 * component reads on this branch.
 */
type AssetsSidebarErrorPayload = { error: { message: string } };

/** The slice of the fetcher API the sidebar actually touches. */
type FetcherStub = {
  state: "idle" | "loading" | "submitting";
  data: AssetsSidebarPayload | AssetsSidebarErrorPayload | undefined;
  load: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
};

function createFetcherStub(): FetcherStub {
  return {
    state: "idle",
    data: undefined,
    // The component `void`s the returned promise, so resolve immediately.
    load: vi.fn(() => Promise.resolve()),
    submit: vi.fn(),
  };
}

/**
 * Mutable per-test fetcher stub. Tests mutate `fetcherStub.data` to
 * simulate the fetch resolving, then re-render (the real fetcher triggers
 * that re-render itself when data lands).
 */
let fetcherStub: FetcherStub = createFetcherStub();

// why: the sidebar's lazy mode is driven by `useFetcher` — mocking it lets
// tests assert "no request fired" / "exactly one request" and hand-feed
// the resolved payload without spinning up a data router. `Link` is
// swapped for a plain anchor for the same reason (the "Scan to assign"
// link and the asset-title `Button to=` both need a router at runtime).
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    ...actual,
    useFetcher: () => fetcherStub,
    Link: ({ to, children, ...rest }: ComponentProps<"a"> & { to: string }) => (
      <a {...rest} href={to}>
        {children}
      </a>
    ),
  };
});

// why: useCurrentOrganization reads the `_layout` route's loader data via
// useRouteLoaderData, which requires a data-router context these tests
// don't mount. Returning undefined exercises the component's documented
// no-org branch (display-code chips are skipped) — irrelevant to the
// dual-mode behavior under test.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => undefined,
}));

// why: the real AssetImage wires its own useFetcher for signed-URL refresh,
// which would collide with the sidebar's mocked fetcher instance (both
// callers would receive the same stub and AssetImage would misread the
// sidebar payload). A bare <img> keeps each row's image slot inert.
vi.mock("~/components/assets/asset-image", () => ({
  AssetImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

type SidebarBooking = ComponentProps<typeof BookingAssetsSidebar>["booking"];

/**
 * Minimal, type-correct `BookingAsset` pivot row: a standalone (no kit)
 * INDIVIDUAL asset — the simplest shape `groupAssets` renders as one
 * individual row.
 */
function buildBookingAsset({
  id,
  title,
}: {
  id: string;
  title: string;
}): SidebarBookingAssets[number] {
  return {
    id: `ba-${id}`,
    quantity: 1,
    assetKitId: null,
    asset: {
      id,
      title,
      type: "INDIVIDUAL",
      availableToBook: true,
      custody: [],
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
    },
  };
}

/** Outstanding (unfulfilled) Book-by-Model reservation: 2 of 3 remaining. */
function buildModelRequest(
  overrides?: Partial<SidebarModelRequest>
): SidebarModelRequest {
  return {
    id: "mreq-1",
    assetModelId: "model-1",
    quantity: 3,
    fulfilledQuantity: 1,
    fulfilledAt: null,
    assetModel: { id: "model-1", name: "Sony A7 IV" },
    ...overrides,
  };
}

function buildBooking(overrides?: Partial<SidebarBooking>): SidebarBooking {
  return {
    id: "booking-1",
    name: "Studio session",
    status: "RESERVED",
    ...overrides,
  };
}

/** Successful lazy-fetch payload with empty qty-progress maps. */
function buildPayload(
  bookingAssets: SidebarBookingAssets
): AssetsSidebarPayload {
  return {
    error: null,
    bookingAssets,
    dispositionedByAsset: {},
    dispositionBreakdownByAsset: {},
    checkedOutByAsset: {},
  };
}

/** The lazy path's loading indicator (shared `Spinner`, class-based). */
function querySpinner() {
  return document.querySelector(".spinner");
}

describe("BookingAssetsSidebar", () => {
  beforeEach(() => {
    fetcherStub = createFetcherStub();
  });

  it("eager mode: renders rows from the inline payload without firing a fetch", async () => {
    const user = userEvent.setup();
    render(
      <BookingAssetsSidebar
        booking={buildBooking({
          bookingAssets: [
            buildBookingAsset({ id: "asset-1", title: "Camera A" }),
            buildBookingAsset({ id: "asset-2", title: "Tripod B" }),
          ],
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "2 assets" }));

    expect(screen.getByText(/Assets in "Studio session"/)).toBeInTheDocument();
    expect(screen.getByText("Camera A")).toBeInTheDocument();
    expect(screen.getByText("Tripod B")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    // Eager data is instant: no spinner, and the lazy endpoint is never hit.
    expect(querySpinner()).not.toBeInTheDocument();
    expect(fetcherStub.load).not.toHaveBeenCalled();
  });

  it("lazy mode: fetches exactly once on open, shows a spinner, then renders rows", async () => {
    const user = userEvent.setup();
    // Bookings-index shape: `_count` for the trigger label, no pivots.
    const booking = buildBooking({ _count: { bookingAssets: 2 } });
    const { rerender } = render(<BookingAssetsSidebar booking={booking} />);

    await user.click(screen.getByRole("button", { name: "2 assets" }));

    expect(fetcherStub.load).toHaveBeenCalledTimes(1);
    expect(fetcherStub.load).toHaveBeenCalledWith(
      "/api/bookings/booking-1/assets-sidebar"
    );
    // In flight: spinner shows, no rows yet.
    expect(querySpinner()).toBeInTheDocument();
    expect(screen.queryByText("Camera A")).not.toBeInTheDocument();

    // Resolve the fetch. The real fetcher re-renders the component when
    // data lands; with the stub we mutate + re-render explicitly.
    fetcherStub.data = buildPayload([
      buildBookingAsset({ id: "asset-1", title: "Camera A" }),
      buildBookingAsset({ id: "asset-2", title: "Tripod B" }),
    ]);
    rerender(<BookingAssetsSidebar booking={booking} />);

    expect(querySpinner()).not.toBeInTheDocument();
    expect(screen.getByText("Camera A")).toBeInTheDocument();
    expect(screen.getByText("Tripod B")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("lazy mode: closing and reopening renders each row once (refresh, not append)", async () => {
    const user = userEvent.setup();
    const booking = buildBooking({ _count: { bookingAssets: 1 } });
    const { rerender } = render(<BookingAssetsSidebar booking={booking} />);

    // First open + resolved fetch.
    await user.click(screen.getByRole("button", { name: "1 assets" }));
    fetcherStub.data = buildPayload([
      buildBookingAsset({ id: "asset-1", title: "Camera A" }),
    ]);
    rerender(<BookingAssetsSidebar booking={booking} />);
    expect(screen.getAllByText("Camera A")).toHaveLength(1);

    // Close via the sheet's X — content unmounts.
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Camera A")).not.toBeInTheDocument();

    // Reopen: the retained payload renders immediately (no spinner flash)
    // and rows are NOT duplicated. The component deliberately re-fetches
    // on each open for freshness — pin that too.
    await user.click(screen.getByRole("button", { name: "1 assets" }));
    expect(screen.getAllByText("Camera A")).toHaveLength(1);
    expect(querySpinner()).not.toBeInTheDocument();
    expect(fetcherStub.load).toHaveBeenCalledTimes(2);
  });

  it("lazy mode: a settled error shows the error state with retry instead of an endless spinner", async () => {
    const user = userEvent.setup();
    const booking = buildBooking({ _count: { bookingAssets: 2 } });
    const { rerender } = render(<BookingAssetsSidebar booking={booking} />);

    await user.click(screen.getByRole("button", { name: "2 assets" }));
    // Fetch settles with an error payload (booking deleted / permission
    // lost between page load and drawer open).
    fetcherStub.data = { error: { message: "Booking not found" } };
    rerender(<BookingAssetsSidebar booking={booking} />);

    expect(querySpinner()).not.toBeInTheDocument();
    expect(
      screen.getByText("Failed to load the booking's assets.")
    ).toBeInTheDocument();

    // Retry re-fires the fetch: once on open, once from the button.
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetcherStub.load).toHaveBeenCalledTimes(2);
    expect(fetcherStub.load).toHaveBeenLastCalledWith(
      "/api/bookings/booking-1/assets-sidebar"
    );
  });

  it("zero concrete assets + outstanding model requests: trigger stays openable and renders the reservations section", async () => {
    const user = userEvent.setup();
    render(
      <BookingAssetsSidebar
        booking={buildBooking({
          // Eager-empty payload (pure Book-by-Model booking).
          bookingAssets: [],
          modelRequests: [buildModelRequest()],
        })}
      />
    );

    // 0 concrete assets, but the outstanding reservation keeps the
    // trigger clickable (`hasItems` counts unfulfilled model requests).
    await user.click(screen.getByRole("button", { name: "0 assets" }));

    // quantity 3 − fulfilled 1 = 2 remaining across 1 model.
    expect(
      screen.getByText("Unassigned model reservations (2)")
    ).toBeInTheDocument();
    expect(screen.getByText("Sony A7 IV")).toBeInTheDocument();
    expect(screen.getByText("2 remaining")).toBeInTheDocument();
    // RESERVED is scan-to-assign eligible.
    expect(
      screen.getByRole("link", { name: "Scan to assign" })
    ).toHaveAttribute("href", "/bookings/booking-1/overview/scan-assets");
    // The empty-but-present eager payload means: no lazy fetch, no
    // spinner, and an empty assets table below the reservations.
    expect(screen.getByText("0 items")).toBeInTheDocument();
    expect(querySpinner()).not.toBeInTheDocument();
    expect(fetcherStub.load).not.toHaveBeenCalled();
  });

  it("zero assets + only fulfilled model requests: trigger is inert and the sheet never opens", async () => {
    const user = userEvent.setup();
    render(
      <BookingAssetsSidebar
        booking={buildBooking({
          _count: { bookingAssets: 0 },
          // Fully-fulfilled requests don't count toward `hasItems`.
          modelRequests: [
            buildModelRequest({
              fulfilledQuantity: 3,
              fulfilledAt: new Date("2026-07-01T00:00:00.000Z"),
            }),
          ],
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "0 assets" }));

    expect(screen.queryByText(/Assets in/)).not.toBeInTheDocument();
    expect(fetcherStub.load).not.toHaveBeenCalled();
  });
});
