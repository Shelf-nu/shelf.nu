/**
 * Smoke tests for {@link PartialCheckoutDrawer} qty-input rendering.
 *
 * These contract-level tests cover only the drawer-side behaviour Wave B
 * introduces: the qty-input block appears for QUANTITY_TRACKED scanned
 * assets (defaulted to the slice's full remaining), is absent for
 * INDIVIDUAL scanned assets, and the input's `max` clamps via the
 * constraint-validation API the same way `MoveUnitsDialog` does. Server-
 * side semantics (per-slice atomicity, recordEvent emission) are covered
 * by Wave 2 service-level tests on `partialCheckoutBooking`.
 *
 * Tests mount the drawer inside a scoped jotai `Provider` with a
 * `createStore()` instance so each case starts from a clean atom tree.
 * The mock surface mirrors `partial-checkin-drawer.test.tsx` — same
 * react-router stubs, same DateS / code-scanner / list-header
 * neutralisations.
 *
 * @see {@link file://./partial-checkout-drawer.tsx}
 */

import type { ReactNode } from "react";
import { AssetStatus, BookingStatus } from "@prisma/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { useLoaderData, useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scannedItemsAtom } from "~/atoms/qr-scanner";

import PartialCheckoutDrawer from "./partial-checkout-drawer";

// why: react-router's `useLoaderData` runs outside a real Remix route
// context here — we stub it with deterministic data per test. `Link` /
// `Form` are reduced to native equivalents so transitive components
// don't require a data router.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useRouteLoaderData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useLocation: vi.fn(() => ({
      pathname: "/bookings/booking-1/overview/checkout-assets",
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

// why: DateS renders behind its own date provider chain we don't need
// here — the booking-header just shows from/to in a non-asserted region.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}));

// why: the scanner-mode MutationObserver hook used by `base-drawer`
// reads the DOM for the live code scanner — no value here, and
// stubbing avoids pulling the full scanner module graph into the test.
vi.mock("~/components/scanner/code-scanner", () => ({
  useGlobalModeViaObserver: () => "scanner",
}));

// why: ListHeader uses `useStickyHeaderPortal`, whose mount effect
// reads `thead.rows[0].cells` — fine in a browser but happy-dom's
// HTMLCollection crashes the render. A minimal stub preserves the
// semantic structure without the portal machinery. Mirrors the
// partial-checkin-drawer test.
vi.mock("~/components/list/list-header", () => ({
  ListHeader: ({ children }: { children: any }) => (
    <thead>
      <tr>{children}</tr>
    </thead>
  ),
}));

// why: Radix Popover doesn't reliably open in happy-dom (portal +
// pointer-events plumbing). Mirrors the canonical mock pattern used by
// `move-units-dialog.test.tsx` and `sort-by.test.tsx`. The drawer's
// transitive consumers (asset-index view-state hooks etc.) compose with
// popovers in places we don't assert against.
vi.mock("@radix-ui/react-popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverPortal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useRouteLoaderDataMock = vi.mocked(useRouteLoaderData);

/* ------------------------- fixture helpers ------------------------- */

type AssetKind = "INDIVIDUAL" | "QUANTITY_TRACKED";

type ScannedAssetFixture = {
  id: string;
  title: string;
  kind: AssetKind;
  /** Booked qty for the slice. Only meaningful for QUANTITY_TRACKED. */
  bookedQuantity?: number;
  unitOfMeasure?: string | null;
};

/**
 * Build a minimal loader-data payload matching what the partial-checkout
 * drawer reads. Mirrors the shape of the checkout-assets route loader
 * return: `{ booking, checkedOutAssetIds, checkedInAssetIds,
 * remainingToCheckOutByAsset }`.
 *
 * @param assets Scanned-asset fixtures the booking holds.
 * @param overrides Optional loader-field overrides. `checkedOutAssetIds`
 *   simulates a prior partial-checkout record; `remainingToCheckOutByAsset`
 *   feeds the QT top-off path the drawer uses to gate eligibility on
 *   per-asset units-still-to-check-out (vs the binary "already checked
 *   out" flag).
 */
function makeLoaderData(
  assets: ScannedAssetFixture[],
  overrides: {
    checkedOutAssetIds?: string[];
    checkedInAssetIds?: string[];
    remainingToCheckOutByAsset?: Record<string, number>;
    /** Override per-asset live status (default: AVAILABLE). */
    statusByAssetId?: Record<string, AssetStatus>;
  } = {}
) {
  const bookingAssets = assets.map((a) => ({
    id: `ba-${a.id}`,
    assetId: a.id,
    quantity: a.kind === "QUANTITY_TRACKED" ? a.bookedQuantity ?? 1 : 1,
    asset: {
      id: a.id,
      title: a.title,
      status: overrides.statusByAssetId?.[a.id] ?? AssetStatus.AVAILABLE,
      kitId: null,
      type: a.kind,
      unitOfMeasure: a.unitOfMeasure ?? null,
      assetKits: [],
    },
  }));

  return {
    booking: {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.RESERVED,
      from: new Date("2024-01-01T10:00:00Z"),
      to: new Date("2024-01-05T10:00:00Z"),
      custodianUserId: "user-1",
      bookingAssets,
    },
    checkedOutAssetIds: overrides.checkedOutAssetIds ?? ([] as string[]),
    checkedInAssetIds: overrides.checkedInAssetIds ?? ([] as string[]),
    remainingToCheckOutByAsset: overrides.remainingToCheckOutByAsset ?? {},
  };
}

/**
 * Build a scanned-item payload mirroring what the get-scanned-item API
 * hydrates into the atom — `type: "asset"` plus `data` carrying the
 * AssetFromQr shape the AssetRow renderer reads.
 */
function scannedAsset(asset: ScannedAssetFixture) {
  return {
    type: "asset" as const,
    codeType: "qr" as const,
    data: {
      id: asset.id,
      title: asset.title,
      status: AssetStatus.AVAILABLE,
      type: asset.kind,
      unitOfMeasure: asset.unitOfMeasure ?? null,
      assetKits: [],
    },
  };
}

/**
 * The full `AssetFromQr` Prisma payload includes many relations the drawer
 * never reads (assetLocations, custody, etc.); modelling them in every test
 * fixture would be churn for zero coverage. Mirrors the sibling
 * `partial-checkin-drawer.test.tsx` pattern of typing the scanned-items
 * map loosely so a minimal fixture is acceptable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedStore(scanned: Record<string, any>) {
  const store = createStore();
  store.set(scannedItemsAtom, scanned);
  return store;
}

function renderDrawer(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(<PartialCheckoutDrawer defaultExpanded />, { wrapper });
}

/* ---------------------------- tests -------------------------------- */

describe("PartialCheckoutDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouteLoaderDataMock.mockReturnValue({ minimizedSidebar: false });
  });

  it("renders without crashing for a booking with mixed asset types", () => {
    const assets: ScannedAssetFixture[] = [
      { id: "asset-ind", title: "Camera body", kind: "INDIVIDUAL" },
      {
        id: "asset-qty",
        title: "Battery pack",
        kind: "QUANTITY_TRACKED",
        bookedQuantity: 8,
        unitOfMeasure: "pcs",
      },
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore({
      "qr-ind": scannedAsset(assets[0]),
      "qr-qty": scannedAsset(assets[1]),
    });

    renderDrawer(store);

    // Both titles render in their respective AssetRow blocks.
    expect(screen.getByText("Camera body")).toBeInTheDocument();
    expect(screen.getByText("Battery pack")).toBeInTheDocument();
  });

  it("shows a qty input with default = full remaining for each QUANTITY_TRACKED scanned asset", () => {
    const assets: ScannedAssetFixture[] = [
      {
        id: "asset-qty-a",
        title: "Battery pack",
        kind: "QUANTITY_TRACKED",
        bookedQuantity: 8,
        unitOfMeasure: "pcs",
      },
      {
        id: "asset-qty-b",
        title: "Gaffer tape",
        kind: "QUANTITY_TRACKED",
        bookedQuantity: 3,
        unitOfMeasure: null,
      },
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore({
      "qr-qty-a": scannedAsset(assets[0]),
      "qr-qty-b": scannedAsset(assets[1]),
    });

    renderDrawer(store);

    const inputs = screen.getAllByLabelText(
      /check out quantity/i
    ) as HTMLInputElement[];

    // One qty input per QUANTITY_TRACKED scanned asset.
    expect(inputs).toHaveLength(2);

    // Default value mirrors the slice's full remaining qty.
    const values = inputs.map((i) => i.value).sort();
    expect(values).toEqual(["3", "8"]);

    // Each input is clamped to the slice's remaining via `max`.
    const maxes = inputs.map((i) => Number(i.max)).sort((a, b) => a - b);
    expect(maxes).toEqual([3, 8]);
  });

  it("does NOT show a qty input for INDIVIDUAL scanned assets", () => {
    const assets: ScannedAssetFixture[] = [
      { id: "asset-ind-1", title: "Camera body", kind: "INDIVIDUAL" },
      { id: "asset-ind-2", title: "Tripod", kind: "INDIVIDUAL" },
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore({
      "qr-ind-1": scannedAsset(assets[0]),
      "qr-ind-2": scannedAsset(assets[1]),
    });

    renderDrawer(store);

    // Asset titles render, but no qty inputs are present anywhere.
    expect(screen.getByText("Camera body")).toBeInTheDocument();
    expect(screen.getByText("Tripod")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/check out quantity/i)
    ).not.toBeInTheDocument();
  });

  it("sets validity.rangeOverflow=true when the qty input exceeds max", () => {
    const assets: ScannedAssetFixture[] = [
      {
        id: "asset-qty",
        title: "Battery pack",
        kind: "QUANTITY_TRACKED",
        bookedQuantity: 5,
        unitOfMeasure: "pcs",
      },
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderData(assets));

    const store = seedStore({
      "qr-qty": scannedAsset(assets[0]),
    });

    renderDrawer(store);

    const input = screen.getByLabelText(
      /check out quantity/i
    ) as HTMLInputElement;

    // why: assert what's actually testable in happy-dom — the input
    // surfaces the over-max condition via the constraint-validation
    // API. Real browsers then block form submission on the `invalid`
    // event; happy-dom doesn't model that event-cycle, so asserting
    // submission was blocked would be brittle. Mirrors the same
    // approach used in `move-units-dialog.test.tsx`.
    fireEvent.change(input, { target: { value: "10" } });

    expect(input.validity.rangeOverflow).toBe(true);
    expect(Number(input.max)).toBe(5);
  });

  /**
   * Partial top-off contract for QUANTITY_TRACKED assets.
   *
   * When a QT asset has a prior partial-checkout record for this booking
   * but still has units left to check out (loader-computed
   * `remainingToCheckOutByAsset[asset.id] > 0`), the drawer MUST:
   *
   *  - suppress the "Already checked out" badge on the scanned row;
   *  - render the qty input pre-filled with the remaining units and
   *    clamped by `max=remaining` — NOT `bookingAsset.quantity`, since
   *    the booked total would let the operator over-commit;
   *  - keep the asset OUT of the "already checked out" blocker list.
   *
   * Pre-fix the asset's presence in `checkedOutAssetIds` flipped both the
   * badge and the blocker, hiding the qty input and forcing operators to
   * use the bulk dialog (which had the same limitation).
   *
   * INDIVIDUAL assets are intentionally unchanged — see the singular
   * check-out test above; they reject on second scan.
   */
  it("renders the qty input for a QT asset with a partial top-off pending", () => {
    const pencils: ScannedAssetFixture = {
      id: "pencils-id",
      title: "Pencils",
      kind: "QUANTITY_TRACKED",
      bookedQuantity: 50,
      unitOfMeasure: "pcs",
    };
    useLoaderDataMock.mockReturnValue(
      makeLoaderData([pencils], {
        // Prior checkout recorded for this booking (e.g. operator
        // checked out 5 of 50 units yesterday).
        checkedOutAssetIds: ["pencils-id"],
        // 45 units still bookable — the operator is here to top off.
        remainingToCheckOutByAsset: { "pencils-id": 45 },
      })
    );

    const store = seedStore({ "qr-pencils": scannedAsset(pencils) });
    renderDrawer(store);

    // The row renders without the "Already checked out" badge — the
    // asset still has units left, so the binary blocker label must not
    // surface here.
    expect(screen.getByText("Pencils")).toBeInTheDocument();
    expect(screen.queryByText(/already checked out/i)).not.toBeInTheDocument();

    // The qty input is present, defaulted to and capped at the
    // loader-supplied remaining (45) — NOT the booked quantity (50),
    // which would let the operator over-commit.
    const input = screen.getByLabelText(
      /check out quantity/i
    ) as HTMLInputElement;
    expect(input.value).toBe("45");
    expect(Number(input.max)).toBe(45);
  });

  it("shows 'Already checked out' and hides the qty input when remaining = 0", () => {
    const pencils: ScannedAssetFixture = {
      id: "pencils-id",
      title: "Pencils",
      kind: "QUANTITY_TRACKED",
      bookedQuantity: 50,
      unitOfMeasure: "pcs",
    };
    useLoaderDataMock.mockReturnValue(
      makeLoaderData([pencils], {
        checkedOutAssetIds: ["pencils-id"],
        // Fully reconciled — no more units to check out.
        remainingToCheckOutByAsset: { "pencils-id": 0 },
      })
    );

    const store = seedStore({ "qr-pencils": scannedAsset(pencils) });
    renderDrawer(store);

    // The asset renders, BUT the "Already checked out" badge surfaces
    // (remaining = 0 → fully out) and the qty input is suppressed.
    expect(screen.getByText("Pencils")).toBeInTheDocument();
    expect(screen.getAllByText(/already checked out/i).length).toBeGreaterThan(
      0
    );
    expect(
      screen.queryByLabelText(/check out quantity/i)
    ).not.toBeInTheDocument();
  });
});
