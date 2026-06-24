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
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { useLoaderData, useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type BookingExpectedAsset,
  bookingExpectedAssetsAtom,
  QUICK_CHECKOUT_QR_PREFIX,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";

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
 *
 * @param scanned   Pre-seeded scanned-items map (qrId → item shape).
 * @param expected  Pre-seeded expected-assets list (drives the
 *   pending-items renderer). Passed through to `bookingExpectedAssetsAtom`
 *   so the drawer's `useAtomValue(bookingExpectedAssetsAtom)` returns it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedStore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scanned: Record<string, any>,
  expected: BookingExpectedAsset[] = []
) {
  const store = createStore();
  store.set(scannedItemsAtom, scanned);
  store.set(bookingExpectedAssetsAtom, expected);
  return store;
}

/* -------- pending-list expected-asset fixture helpers ---------- */

/**
 * Build an INDIVIDUAL expected-asset fixture in the shape the loader
 * emits (`BookingExpectedAsset` discriminated union, `kind: "INDIVIDUAL"`).
 * Defaults match a pristine, never-checked-out asset; overrides flip
 * fields per test.
 */
function individualExpected(
  overrides: Partial<Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }>> = {}
): Extract<BookingExpectedAsset, { kind: "INDIVIDUAL" }> {
  const id = overrides.id ?? "asset-ind";
  return {
    kind: "INDIVIDUAL",
    id,
    bookingAssetId: `ba-${id}`,
    title: "Camera",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    alreadyCheckedIn: false,
    ...overrides,
  };
}

/**
 * Build a QUANTITY_TRACKED expected-asset fixture. `booked`/`logged`/
 * `remaining` default to a pristine 20-unit slice; overrides flip them
 * per test (Polish-7b multi-slice tests override `bookingAssetId` so two
 * slices of the same asset are independent).
 */
function qtyExpected(
  overrides: Partial<
    Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }>
  > = {}
): Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }> {
  const id = overrides.id ?? "asset-qty";
  return {
    kind: "QUANTITY_TRACKED",
    id,
    bookingAssetId: `ba-${id}`,
    title: "Battery pack",
    mainImage: null,
    thumbnailImage: null,
    kitId: null,
    kitName: null,
    booked: 20,
    logged: 0,
    remaining: 20,
    breakdown: { returned: 0, consumed: 0, lost: 0, damaged: 0 },
    consumptionType: null,
    ...overrides,
  };
}

/**
 * Build a loader-data payload driven by an expected-assets list. Used by
 * the pending-list contract tests: the drawer's `useLoaderData()` returns
 * `booking.bookingAssets` derived from each expected entry so its
 * eligibility / blocker pipelines stay consistent with what the pending
 * list shows.
 *
 * Mirrors the checkin test's `makeLoaderData(expectedAssets)` shape but
 * keyed off `BookingExpectedAsset` — the checkout-specific loader fields
 * (`checkedOutAssetIds`, `checkedInAssetIds`, `remainingToCheckOutByAsset`)
 * are derived from the qty entries so a partial top-off renders correctly.
 */
function makeLoaderDataFromExpected(
  expectedAssets: BookingExpectedAsset[],
  overrides: {
    checkedOutAssetIds?: string[];
    checkedInAssetIds?: string[];
    remainingToCheckOutByAsset?: Record<string, number>;
  } = {}
) {
  const bookingAssets = expectedAssets.map((a) => ({
    id: a.bookingAssetId,
    assetId: a.id,
    quantity: a.kind === "QUANTITY_TRACKED" ? a.booked : 1,
    asset: {
      id: a.id,
      title: a.title,
      status: AssetStatus.AVAILABLE,
      kitId: a.kitId ?? null,
      type: a.kind === "QUANTITY_TRACKED" ? "QUANTITY_TRACKED" : "INDIVIDUAL",
      unitOfMeasure: null,
      assetKits: [],
    },
  }));

  // Default the remaining map from the qty entries so per-slice top-off
  // works without callers having to hand-roll the map for every test.
  const remainingToCheckOutByAsset =
    overrides.remainingToCheckOutByAsset ??
    expectedAssets.reduce<Record<string, number>>((acc, a) => {
      if (a.kind === "QUANTITY_TRACKED") {
        acc[a.id] = (acc[a.id] ?? 0) + a.remaining;
      }
      return acc;
    }, {});

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
    remainingToCheckOutByAsset,
  };
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

  /* ---- pending-items-list contract (mirrors check-in tests) ----- */

  /**
   * Mirror of `partial-checkin-drawer.test.tsx` test "exposes 'Check in
   * without scanning' only on pending qty-tracked rows".
   *
   * The pending-list renderer surfaces a quick-action button on each
   * QUANTITY_TRACKED pending row (no physical barcode → can't be
   * scanned) but NEVER on INDIVIDUAL rows (each is a discrete physical
   * object that must be physically confirmed). Already-checked-out
   * individuals are dropped from the pending bucket entirely.
   */
  it("exposes 'Check out without scanning' only on pending qty-tracked rows", () => {
    const assets: BookingExpectedAsset[] = [
      individualExpected({ id: "asset-ind-1", title: "Camera body" }),
      qtyExpected({ id: "asset-qty-1", title: "Battery" }),
      // already-checked-out individual: drops out of pending entirely
      // (no row, no button — checkout direction is terminal for that
      // asset on this booking).
      individualExpected({
        id: "asset-ind-done",
        title: "Lens",
        alreadyCheckedIn: true,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderDataFromExpected(assets));

    const store = seedStore({}, assets);
    renderDrawer(store);

    const buttons = screen.queryAllByRole("button", {
      name: /check out without scanning/i,
    });
    // Exactly one — the qty-tracked pending row.
    expect(buttons).toHaveLength(1);

    // The pending-qty row title must be adjacent to the button.
    const row = buttons[0].closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Battery")).toBeInTheDocument();

    // The pending INDIVIDUAL row still renders, but exposes no button.
    expect(screen.getByText("Camera body")).toBeInTheDocument();
  });

  /**
   * Mirror of check-in's "click inserts a synthetic-keyed entry into
   * scannedItemsAtom". Asserts the key shape — Polish-7b requires the
   * key be the slice's `bookingAssetId` so two pending slices of the
   * same asset get independent synthetic entries.
   */
  it("click inserts a synthetic-keyed entry into scannedItemsAtom under qty-checkout: prefix", async () => {
    const assets: BookingExpectedAsset[] = [
      qtyExpected({
        id: "asset-qty-click",
        title: "Tripod",
        booked: 5,
        remaining: 5,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderDataFromExpected(assets));

    const store = seedStore({}, assets);
    renderDrawer(store);

    // Pre-condition: no synthetic entries yet.
    expect(Object.keys(store.get(scannedItemsAtom))).toHaveLength(0);

    const button = screen.getByRole("button", {
      name: /check out without scanning/i,
    });
    const user = userEvent.setup();
    await user.click(button);

    const items = store.get(scannedItemsAtom);
    const keys = Object.keys(items);
    expect(keys).toHaveLength(1);
    // Polish-7b: synthetic key is the slice's bookingAssetId (`ba-<id>`),
    // namespaced under the checkout prefix so the synthetic-key probe
    // in AssetRow can distinguish direction.
    expect(keys[0]).toBe(`${QUICK_CHECKOUT_QR_PREFIX}ba-asset-qty-click`);
    expect(items[keys[0]]?.type).toBe("asset");
  });

  /**
   * Polish-6 multi-row sanity (mirror of check-in's identical test):
   * an asset with two BookingAsset slices (same asset.id, different
   * bookingAssetId) renders two independently checkable rows. Neither
   * synthetic entry overwrites the other; both end up in
   * `scannedItemsAtom` keyed by their respective slice ids.
   */
  it("renders independent quick-checkout rows for two pending slices of the same asset", async () => {
    const assets: BookingExpectedAsset[] = [
      qtyExpected({
        id: "asset-multi",
        bookingAssetId: "ba-slice-a",
        title: "AA batteries",
        booked: 50,
        remaining: 50,
      }),
      qtyExpected({
        id: "asset-multi",
        bookingAssetId: "ba-slice-b",
        title: "AA batteries",
        booked: 33,
        remaining: 33,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderDataFromExpected(assets));

    const store = seedStore({}, assets);
    renderDrawer(store);

    // Both slices render their own button — independent rows.
    expect(
      screen.getAllByRole("button", { name: /check out without scanning/i })
    ).toHaveLength(2);

    const user = userEvent.setup();
    // Click the first slice's button; that activates it in the scanned
    // bucket (its button disappears from pending), so re-query for the
    // second.
    await user.click(
      screen.getAllByRole("button", {
        name: /check out without scanning/i,
      })[0]
    );
    await user.click(
      screen.getByRole("button", { name: /check out without scanning/i })
    );

    const keys = Object.keys(store.get(scannedItemsAtom)).sort();
    expect(keys).toEqual(
      [
        `${QUICK_CHECKOUT_QR_PREFIX}ba-slice-a`,
        `${QUICK_CHECKOUT_QR_PREFIX}ba-slice-b`,
      ].sort()
    );
  });

  /**
   * Regression for the checkout-drawer twin of the check-in fix at
   * `partial-checkin-drawer.tsx:1060-1097`: scanning a kit must remove
   * its INDIVIDUAL members from the Pending section so the kit doesn't
   * double-render (once under "Checked out this session" via `KitRow`
   * AND again as a pending kit-group whose 3 members are still loose).
   *
   * Pre-fix `scannedAssetIds` was built from `assets` only (no kit-
   * member contribution), so the pending bucket filter at the `buckets`
   * memo treated the kit's members as still pending and re-grouped them
   * under the kit name in the muted Pending section. Post-fix the kit's
   * `assetKits[].asset.id` contributions populate `scannedAssetIds`,
   * the members drop out of `pendingIndividuals`, and the Pending
   * section disappears entirely.
   */
  it("scanning a kit removes its INDIVIDUAL members from the Pending section", () => {
    const kitId = "kit-defense";
    const kitName = "Defense Equipment";
    const members: BookingExpectedAsset[] = [
      individualExpected({
        id: "asset-elysian",
        title: "Elysian",
        kitId,
        kitName,
      }),
      individualExpected({
        id: "asset-justiciar",
        title: "Justiciar",
        kitId,
        kitName,
      }),
      individualExpected({
        id: "asset-spectral",
        title: "Spectral",
        kitId,
        kitName,
      }),
    ];
    useLoaderDataMock.mockReturnValue(makeLoaderDataFromExpected(members));

    // Seed the kit as scanned this session. `data.assetKits[].asset.id`
    // mirrors the `KIT_INCLUDE` payload shape (see
    // `~/utils/scanner-includes.server.ts`) — the same shape the
    // production scanner API hydrates into `scannedItemsAtom`.
    const store = seedStore(
      {
        "qr-kit-defense": {
          type: "kit" as const,
          codeType: "qr" as const,
          data: {
            id: kitId,
            name: kitName,
            status: AssetStatus.AVAILABLE,
            assetKits: members.map((m) => ({
              id: `ak-${m.id}`,
              asset: {
                id: m.id,
                status: AssetStatus.AVAILABLE,
                type: "INDIVIDUAL" as const,
                availableToBook: true,
                custody: null,
              },
            })),
          },
        },
      },
      members
    );

    renderDrawer(store);

    // The kit's name renders ONCE (in the scanned-this-session bucket
    // via `KitRow`). Pre-fix it would also have appeared inside the
    // muted Pending section as a kit-group header.
    expect(screen.getAllByText(kitName)).toHaveLength(1);

    // The Pending section header is absent entirely — when every member
    // is covered by the kit scan, `pendingCount` collapses to 0 and
    // `PendingItemsList` skips its `Pending (N)` header.
    expect(screen.queryByText(/^Pending \(/)).not.toBeInTheDocument();

    // Defensive: none of the kit's INDIVIDUAL members surface as loose
    // pending rows either (the original bug rendered each as a
    // pending child under the kit group).
    expect(screen.queryByText("Elysian")).not.toBeInTheDocument();
    expect(screen.queryByText("Justiciar")).not.toBeInTheDocument();
    expect(screen.queryByText("Spectral")).not.toBeInTheDocument();
  });
});
