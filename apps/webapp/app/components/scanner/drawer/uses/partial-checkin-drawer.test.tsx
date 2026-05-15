/**
 * Contract-level tests for {@link PartialCheckinDrawer}.
 *
 * These tests assert the behaviours the Phase 3c → expected-list
 * refactor introduced:
 *
 *  - Only QUANTITY_TRACKED pending rows expose a
 *    "Check in without scanning" button.
 *  - Clicking that button inserts a synthetic-keyed entry into
 *    `scannedItemsAtom` (so the scanned/pending buckets reclassify).
 *  - The unit-weighted progress numerator counts individuals (1) plus
 *    logged qty-tracked units + typed disposition values.
 *  - When the primary disposition input on a quick-checkin row is
 *    cleared, the zero-disposition blocker renders.
 *
 * Tests mount the drawer inside a scoped jotai `Provider` with a
 * `createStore()` instance so each case starts from a clean atom tree.
 *
 * @see {@link file://./partial-checkin-drawer.tsx}
 */

import type { ReactNode } from "react";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { useLoaderData, useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BookingExpectedAsset,
  QUICK_CHECKIN_QR_PREFIX,
  bookingExpectedAssetsAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";

import PartialCheckinDrawer from "./partial-checkin-drawer";

// why: react-router's `useLoaderData` runs outside a real Remix route
// context here — we stub it with deterministic data for each test.
// `Link` is reduced to an anchor so transitive components don't require
// a router.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useRouteLoaderData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    // `useLocation` + friends are used transitively by `~/components/table`
    // and other consumers. Returning a plain object avoids the
    // `useLocation() may be used only in the context of a <Router>` error
    // without forcing us to wrap the drawer in a MemoryRouter (which
    // would bring its own side-effects — route params, data routers).
    useLocation: vi.fn(() => ({
      pathname: "/bookings/booking-1/overview/checkin-assets",
      search: "",
      hash: "",
      state: null,
      key: "test",
    })),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    // `useFetchers` requires a data router, which we don't spin up here.
    // Transitive callers (asset-index view-state hooks) are safe with an
    // empty fetcher list.
    useFetchers: vi.fn(() => []),
    Link: ({ to, children, ...rest }: any) => (
      <a href={typeof to === "string" ? to : undefined} {...rest}>
        {children}
      </a>
    ),
    Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  };
});

// why: DateS renders with a separate date provider chain we don't need
// here — the drawer header just shows from/to dates in a non-asserted
// region.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}));

// why: the scanner-mode MutationObserver hook reads from the DOM for
// the live code scanner — no value for this drawer-focused test, and
// stubbing avoids pulling in the full scanner module graph.
vi.mock("~/components/scanner/code-scanner", () => ({
  useGlobalModeViaObserver: () => "scanner",
}));

// why: ListHeader uses `useStickyHeaderPortal`, whose mount effect
// reads `thead.rows[0].cells` — fine in a browser but happy-dom's
// HTMLCollection doesn't expose `rows[0]` here and crashes the render.
// A minimal stub preserves the semantic structure (a `thead` wrapping
// its children) without the portal machinery.
vi.mock("~/components/list/list-header", () => ({
  ListHeader: ({ children }: { children: any }) => (
    <thead>
      <tr>{children}</tr>
    </thead>
  ),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useRouteLoaderDataMock = vi.mocked(useRouteLoaderData);

/* ------------------------- fixture helpers ------------------------- */

function individual(
  overrides: Partial<Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }>> = {}
): Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }> {
  return {
    kind: "INDIVIDUAL",
    id: "asset-ind",
    title: "Camera",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    alreadyCheckedIn: false,
    ...overrides,
  };
}

function qty(
  overrides: Partial<
    Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }>
  > = {}
): Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }> {
  return {
    kind: "QUANTITY_TRACKED",
    id: "asset-qty",
    title: "Battery pack",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    booked: 20,
    logged: 0,
    remaining: 20,
    consumptionType: "TWO_WAY",
    ...overrides,
  };
}

/**
 * Build a minimal loader-data payload matching what the drawer reads.
 * Only the fields the drawer actually consumes are populated — keeps the
 * fixtures small and focused.
 */
function makeLoaderData(
  expectedAssets: BookingExpectedAsset[],
  overrides: {
    qtyRemainingByAssetId?: Record<
      string,
      {
        booked: number;
        logged: number;
        remaining: number;
        consumptionType: "ONE_WAY" | "TWO_WAY" | null;
      }
    >;
  } = {}
) {
  // Build bookingAssets mirroring expectedAssets so drawer-internal
  // lookups (e.g. `bookingAssetIds`) work.
  const bookingAssets = expectedAssets.map((a) => ({
    assetId: a.id,
    quantity: a.kind === "QUANTITY_TRACKED" ? a.booked : 1,
    asset: {
      id: a.id,
      title: a.title,
      status: AssetStatus.CHECKED_OUT,
      kitId: a.kitId ?? null,
      type: a.kind === "QUANTITY_TRACKED" ? "QUANTITY_TRACKED" : "INDIVIDUAL",
      consumptionType: a.kind === "QUANTITY_TRACKED" ? a.consumptionType : null,
      mainImage: null,
      thumbnailImage: null,
      kit: null,
    },
  }));

  // Derive a default qtyRemainingByAssetId from expectedAssets unless
  // the caller supplied an override.
  const qtyRemainingByAssetId =
    overrides.qtyRemainingByAssetId ??
    expectedAssets.reduce<
      Record<
        string,
        {
          booked: number;
          logged: number;
          remaining: number;
          consumptionType: "ONE_WAY" | "TWO_WAY" | null;
        }
      >
    >((acc, a) => {
      if (a.kind === "QUANTITY_TRACKED") {
        acc[a.id] = {
          booked: a.booked,
          logged: a.logged,
          remaining: a.remaining,
          consumptionType: a.consumptionType,
        };
      }
      return acc;
    }, {});

  return {
    booking: {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
      from: new Date("2024-01-01T10:00:00Z"),
      to: new Date("2024-01-05T10:00:00Z"),
      custodianUserId: "user-1",
      bookingAssets,
    },
    partialCheckinProgress: {
      checkedInAssetIds: expectedAssets
        .filter((a) => a.kind === "INDIVIDUAL" && a.alreadyCheckedIn)
        .map((a) => a.id),
      uncheckedCount: expectedAssets.length,
    },
    partialCheckinDetails: expectedAssets
      .filter((a) => a.kind === "INDIVIDUAL" && a.alreadyCheckedIn)
      .reduce<Record<string, { id: string }>>((acc, a) => {
        acc[a.id] = { id: a.id };
        return acc;
      }, {}),
    qtyRemainingByAssetId,
    expectedKits: [],
  };
}

/**
 * Seed a jotai store with the drawer's atoms. Expected assets are set
 * directly — the drawer's internal hook (which seeds them from loader
 * data) is out of scope for this unit.
 */
function seedStore(
  expectedAssets: BookingExpectedAsset[],
  scannedItems: Record<string, any> = {}
) {
  const store = createStore();
  store.set(bookingExpectedAssetsAtom, expectedAssets);
  store.set(scannedItemsAtom, scannedItems);
  return store;
}

function renderDrawer(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(<PartialCheckinDrawer defaultExpanded />, { wrapper });
}

/* ---------------------------- tests -------------------------------- */

describe("PartialCheckinDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouteLoaderDataMock.mockReturnValue({ minimizedSidebar: false });
  });

  it("exposes 'Check in without scanning' only on pending qty-tracked rows", () => {
    const assets: BookingExpectedAsset[] = [
      individual({ id: "asset-ind-1", title: "Camera body" }),
      qty({ id: "asset-qty-1", title: "Battery" }),
      individual({
        id: "asset-ind-done",
        title: "Lens",
        alreadyCheckedIn: true,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore(assets);
    renderDrawer(store);

    const buttons = screen.queryAllByRole("button", {
      name: /check in without scanning/i,
    });
    // Exactly one — the qty-tracked pending row.
    expect(buttons).toHaveLength(1);

    // The pending-qty row title must be adjacent to the button. Walk up
    // to the row container and assert the Battery title lives there.
    const row = buttons[0].closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Battery")).toBeInTheDocument();

    // The individual assets (pending + already reconciled) must not
    // surface the button. Already-reconciled rows also render under a
    // collapser (closed by default), so absence of the button is the
    // invariant we care about.
    expect(screen.queryByText("Camera body")).toBeInTheDocument();
  });

  it("click inserts a synthetic-keyed entry into scannedItemsAtom", async () => {
    const assets: BookingExpectedAsset[] = [
      qty({ id: "asset-qty-click", title: "Tripod", booked: 5, remaining: 5 }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore(assets);
    renderDrawer(store);

    // Pre-condition: no synthetic entries.
    expect(Object.keys(store.get(scannedItemsAtom))).toHaveLength(0);

    const button = screen.getByRole("button", {
      name: /check in without scanning/i,
    });
    const user = userEvent.setup();
    await user.click(button);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(`${QUICK_CHECKIN_QR_PREFIX}asset-qty-click`);
    expect(items[keys[0]]?.type).toBe("asset");
  });

  it("unit-weighted progress counts individuals + logged qty + typed disposition", () => {
    // Arrange: 1 INDIVIDUAL (scanned via real key, not alreadyCheckedIn)
    // + 1 QTY_TRACKED booked=20 logged=5 remaining=15.
    // Denominator: 1 + 20 = 21.
    // Numerator: 1 (individual scanned) + 5 (logged) = 6.
    const assets: BookingExpectedAsset[] = [
      individual({ id: "asset-ind-progress", title: "Camera" }),
      qty({
        id: "asset-qty-progress",
        title: "Battery",
        booked: 20,
        logged: 5,
        remaining: 15,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    // Seed a real scan of the individual. Shape mirrors what
    // `addScannedItemAtom` + the API-hydrated row would leave in the
    // atom: `type: "asset"` with `data.id` set.
    const store = seedStore(assets, {
      "real-qr-id-for-individual": {
        type: "asset",
        codeType: "qr",
        data: {
          id: "asset-ind-progress",
          title: "Camera",
          mainImage: null,
          thumbnailImage: null,
          kitId: null,
          consumptionType: null,
        },
      },
    });

    renderDrawer(store);

    // The progress label lives in the drawer title region. We only lock
    // in the numerator/denominator pair — the suffix wording is allowed
    // to drift as UX copy evolves.
    const label = screen.getByText(/\b6\s*\/\s*21\b/);
    expect(label).toBeInTheDocument();
  });

  it("zero-disposition blocker trips when the primary input is cleared on a quick-checkin row", async () => {
    const assets: BookingExpectedAsset[] = [
      qty({
        id: "asset-qty-blocker",
        title: "Battery",
        booked: 4,
        logged: 0,
        remaining: 4,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore(assets);
    renderDrawer(store);

    const button = screen.getByRole("button", {
      name: /check in without scanning/i,
    });

    const user = userEvent.setup();
    await user.click(button);

    // The disposition block renders a `Returned quantity` input. The
    // seed defaults `primary` to the remaining count (4) — clearing it
    // should push the zero-disposition blocker onto the screen.
    const primaryInput = (await screen.findByLabelText(
      /returned quantity/i
    )) as HTMLInputElement;

    // `fireEvent.change` is used instead of `user.clear()` because
    // happy-dom's keyboard path can have quirks with controlled number
    // inputs. This flows through React's onChange the same way.
    fireEvent.change(primaryInput, { target: { value: "" } });

    // Substring match — the blocker copy may evolve. We key off the
    // stable phrase about "no quantity entered".
    expect(await screen.findByText(/no quantity entered/i)).toBeInTheDocument();
  });
});
