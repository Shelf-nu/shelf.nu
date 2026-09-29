/**
 * Reservation-progress tests for {@link AddAssetsToBookingDrawer}, the "Scan
 * to Assign" drawer.
 *
 * The drawer already had its own blockers, submit payload and row renderers
 * before this suite existed; those are exercised elsewhere. What is new here
 * is the reservation context the route seeds into `expectedModelRequestsAtom`
 * and `assignAlreadyIncludedAtom`: the per-model progress strips and the pull
 * list of units still to scan, both built from the same
 * `matchScansToModelRequests` matcher the Check Out drawer uses so the two
 * screens can never disagree about what a scan is worth.
 *
 * @see {@link file://./add-assets-to-booking-drawer.tsx}
 * @see {@link file://./fulfil-reservations-drawer.test.tsx}, whose render
 *   helper this one follows: the same Jotai `Provider` plus seeded
 *   `createStore` pattern.
 */

import { AssetStatus, AssetType, KitStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { useLoaderData, useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AlreadyIncludedRow,
  type ExpectedModelRequest,
  assignAlreadyIncludedAtom,
  expectedModelRequestsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";

import AddAssetsToBookingDrawer from "./add-assets-to-booking-drawer";

// why: react-router hooks run outside a data router here. `Form` is reduced
// to a native equivalent so `ConfigurableDrawer`'s default form renders
// standalone, and `useLoaderData` is stubbed since the drawer (and its
// `AssetRow`/`KitRow` children) read the booking off it directly rather than
// through props. `useLocation` stands in for the one a scanned row pulls in
// transitively: `Table` (`app/components/table.tsx`) calls
// `useAssetIndexViewState`, which calls `useIsAssetIndexPage`, which calls
// `useLocation` to compare the current path against `/assets` - a scanned
// row never renders without it. Mirrors `fulfil-reservations-drawer.test.tsx`.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useRouteLoaderData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useLocation: vi.fn(() => ({
      pathname: "/bookings/booking-1/overview/scan-assets",
      search: "",
      hash: "",
      state: null,
      key: "test",
    })),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    useFetchers: vi.fn(() => []),
    Link: ({ to, children, ...rest }: any) => (
      <a href={typeof to === "string" ? to : undefined} {...rest}>
        {children}
      </a>
    ),
    Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  };
});

// why: the scanner-mode MutationObserver hook used by `base-drawer` reads the
// DOM for the live code scanner (no value here), and stubbing avoids pulling
// the full scanner module graph into the test.
vi.mock("~/components/scanner/code-scanner", () => ({
  useGlobalModeViaObserver: () => "scanner",
}));

// why: ListHeader uses `useStickyHeaderPortal`, whose mount effect reads
// `thead.rows[0].cells`: fine in a browser, but happy-dom's HTMLCollection
// crashes the render.
vi.mock("~/components/list/list-header", () => ({
  ListHeader: ({ children }: { children: any }) => (
    <thead>
      <tr>{children}</tr>
    </thead>
  ),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useRouteLoaderDataMock = vi.mocked(useRouteLoaderData);

/**
 * A resolved asset scan, defaulted so a test only has to state the fields it
 * cares about. `AssetRow` reads `assetKits`, `availableToBook` and `status`
 * on every scan regardless of what the test is checking, so leaving them out
 * would crash the render rather than exercise the reservation logic.
 */
function assetFixture(overrides: Partial<AssetFromQr>): AssetFromQr {
  return {
    id: "asset-x",
    title: "Asset",
    type: AssetType.INDIVIDUAL,
    status: AssetStatus.AVAILABLE,
    availableToBook: true,
    assetKits: [],
    quantity: null,
    unitOfMeasure: null,
    assetModelId: null,
    mainImage: null,
    thumbnailImage: null,
    ...overrides,
  } as AssetFromQr;
}

/** One member of a scanned kit, as the scanner's kit include selects it. */
type KitMember = KitFromQr["assetKits"][number]["asset"];

/**
 * A resolved kit scan, defaulted so a test only has to state its members.
 * `KitRow` reads `status`, `_count.assetKits` and each member's `status` and
 * `availableToBook` on every scan regardless of what the test is checking, so
 * leaving them out would crash the render rather than exercise the matching
 * logic.
 */
function kitFixture({
  id,
  name,
  members,
}: {
  id: string;
  name: string;
  members: Array<Pick<KitMember, "id" | "type" | "assetModelId">>;
}): Partial<KitFromQr> {
  return {
    id,
    name,
    status: KitStatus.AVAILABLE,
    _count: { assetKits: members.length },
    assetKits: members.map((member, index) => ({
      id: `${id}-membership-${index}`,
      quantity: 1,
      asset: {
        status: AssetStatus.AVAILABLE,
        availableToBook: true,
        custody: [],
        ...member,
      },
    })) as KitFromQr["assetKits"],
  };
}

/**
 * Mounts the drawer with a seeded reservation session.
 *
 * @param options.expectedModelRequests - Outstanding model reservations, as
 *   the route's session hook would seed `expectedModelRequestsAtom`.
 * @param options.alreadyIncluded - Assets already on the booking, as the
 *   route would seed `assignAlreadyIncludedAtom`.
 * @param options.bookingAssets - The booking's own `bookingAssets` rows, as
 *   the loader would return them. Drives the "already added to the booking"
 *   blocker, which reads `booking.bookingAssets` directly rather than the
 *   `alreadyIncluded` atom.
 * @param options.scannedAssets - Resolved asset scans, keyed by their QR id.
 * @param options.scannedKits - Resolved kit scans, keyed by their QR id.
 */
function renderDrawer(
  options: {
    expectedModelRequests?: ExpectedModelRequest[];
    alreadyIncluded?: AlreadyIncludedRow[];
    bookingAssets?: Array<{ assetId: string }>;
    scannedAssets?: Record<string, Partial<AssetFromQr>>;
    scannedKits?: Record<string, Partial<KitFromQr>>;
  } = {}
) {
  const store = createStore();
  store.set(expectedModelRequestsAtom, options.expectedModelRequests ?? []);
  store.set(assignAlreadyIncludedAtom, options.alreadyIncluded ?? []);
  store.set(scannedItemsAtom, {
    ...Object.fromEntries(
      Object.entries(options.scannedAssets ?? {}).map(([qrId, asset]) => [
        qrId,
        { type: "asset" as const, data: assetFixture(asset) },
      ])
    ),
    ...Object.fromEntries(
      Object.entries(options.scannedKits ?? {}).map(([qrId, kit]) => [
        qrId,
        { type: "kit" as const, data: kit as KitFromQr },
      ])
    ),
  });

  useLoaderDataMock.mockReturnValue({
    booking: {
      id: "booking-1",
      status: "RESERVED",
      bookingAssets: options.bookingAssets ?? [],
    },
  } as never);
  useRouteLoaderDataMock.mockReturnValue({
    minimizedSidebar: false,
  } as never);

  return render(
    <Provider store={store}>
      <AddAssetsToBookingDrawer />
    </Provider>
  );
}

describe("AddAssetsToBookingDrawer reservation progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a strip and a pending row per outstanding unit", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
        },
      ],
    });

    // Once in the strip's summary, once in its per-model line, and nothing
    // has been scanned yet, so no unit has moved off "0 / 2".
    expect(screen.getAllByText("0 / 2").length).toBeGreaterThan(0);
    // Once from the strip's own line, plus one pending row per outstanding
    // unit (2 remaining, none matched): three renders of the model's name.
    expect(screen.getAllByText("Model One").length).toBe(3);
  });

  // The common case is a booking with no models at all.
  it("renders no progress chrome when nothing is reserved", () => {
    renderDrawer({ expectedModelRequests: [] });

    expect(screen.queryByText(/model reserved/)).toBeNull();
    expect(screen.queryByText(/models reserved/)).toBeNull();
  });

  it("moves the strip when a matching asset is scanned", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
        },
      ],
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
      },
    });

    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("0 / 2")).toHaveLength(0);
  });

  // A kit's member counts once toward the model it answers, even when the
  // operator also scans that member's own QR in the same session.
  it("counts a scanned kit's member once, and not again for the member's own scan", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
        },
      ],
      scannedKits: {
        "qr-kit": kitFixture({
          id: "kit-1",
          name: "Kit One",
          members: [
            {
              id: "asset-1",
              type: AssetType.INDIVIDUAL,
              assetModelId: "model-1",
            },
          ],
        }),
      },
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
      },
    });

    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("2 / 2")).toHaveLength(0);
  });

  // A claimable asset is already on the booking by definition (its row
  // exists with no reservation stamp yet), so it is both in
  // `booking.bookingAssets` and marked `claimable` in `alreadyIncluded`.
  // Scanning it is how it answers the reservation server-side; the
  // "already added to the booking" blocker must not refuse it.
  it("does not disable submit for a claimable already-included asset", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
        },
      ],
      alreadyIncluded: [
        {
          id: "asset-1",
          title: "Asset 1",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-1",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
      ],
      bookingAssets: [{ assetId: "asset-1" }],
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
      },
    });

    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  // Both a credited scan and a refused duplicate are "already on the
  // booking", so that fact alone cannot label the row. Without this the two
  // states render the same red badge, and the blocker's "Remove from list"
  // then takes away whichever row the operator was not looking at.
  it("labels a credited row with its model, and a refused duplicate as already added", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 1,
          remaining: 1,
        },
      ],
      alreadyIncluded: [
        {
          id: "asset-1",
          title: "Asset 1",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-1",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
        {
          id: "asset-2",
          title: "Asset 2",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-1",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
      ],
      bookingAssets: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
      // Only one unit is reserved, so exactly one of these two claims it and
      // the other falls through to the duplicate blocker.
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
        "qr-2": {
          id: "asset-2",
          title: "Asset 2",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
      },
    });

    expect(
      screen.getAllByText("Already here, now counts toward Model One")
    ).toHaveLength(1);
    expect(screen.getAllByText("Already added to this booking")).toHaveLength(
      1
    );
  });

  // `claimable: true` is structural only (standalone, unstamped, INDIVIDUAL);
  // it says nothing about whether an outstanding reservation matches. A
  // booking with no matching model has nothing for the rescan to answer, so
  // it is a plain duplicate and the blocker must fire.
  it("disables submit for a claimable already-included asset whose model matches nothing outstanding", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 2,
          remaining: 2,
        },
      ],
      alreadyIncluded: [
        {
          id: "asset-1",
          title: "Asset 1",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-other",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
      ],
      bookingAssets: [{ assetId: "asset-1" }],
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-other",
        },
      },
    });

    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  // The reservation's remaining capacity is shared across this scan session,
  // via the matcher's single pass over one tally. Two already-included
  // claimable assets of the same model, both scanned, contend for the same
  // unit: the first one processed claims it, and the second has nothing left
  // to answer and is a plain duplicate.
  it("disables submit for a second claimable already-included asset once the first has claimed the model's only remaining unit", () => {
    renderDrawer({
      expectedModelRequests: [
        {
          assetModelId: "model-1",
          assetModelName: "Model One",
          booked: 1,
          remaining: 1,
        },
      ],
      alreadyIncluded: [
        {
          id: "asset-1",
          title: "Asset 1",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-1",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
        {
          id: "asset-2",
          title: "Asset 2",
          mainImage: null,
          thumbnailImage: null,
          assetModelId: "model-1",
          claimable: true,
          kitId: null,
          bookedQuantity: 1,
          type: "INDIVIDUAL",
        },
      ],
      bookingAssets: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
      scannedAssets: {
        "qr-1": {
          id: "asset-1",
          title: "Asset 1",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
        "qr-2": {
          id: "asset-2",
          title: "Asset 2",
          type: AssetType.INDIVIDUAL,
          assetModelId: "model-1",
        },
      },
    });

    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
