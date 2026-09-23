/**
 * Layout contract tests for {@link FulfilReservationsDrawer}.
 *
 * A booking can reserve dozens of asset models, and the drawer renders one
 * progress strip per model in its header. The header is fixed chrome, so it
 * competes for height with the scan list and the check-out button below it —
 * and the drawer is `position: fixed`, so anything pushed past an edge is gone
 * for good rather than merely scrolled away.
 *
 * These cases pin the two structural properties that keep the flow usable at
 * that scale: the model list carries its own scroll, and the check-out form is
 * a sibling of the scrolling list rather than a descendant of it.
 *
 * happy-dom does no layout, so heights are not assertable here — these tests
 * pin the STRUCTURE that makes the layout correct. The height arithmetic is
 * covered separately in `drawer-height.test.ts`.
 *
 * @see {@link file://./fulfil-reservations-drawer.tsx}
 * @see {@link file://./../drawer-height.test.ts}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import { useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ExpectedModelRequest,
  type FulfilSessionInfo,
  expectedModelRequestsAtom,
  fulfilSessionAtom,
  scannedItemsAtom,
} from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";

import FulfilReservationsDrawer from "./fulfil-reservations-drawer";

// why: react-router hooks run outside a data router here. `Link`/`Form` are
// reduced to native equivalents so transitive components render standalone.
// Mirrors `partial-checkout-drawer.test.tsx`.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useRouteLoaderData: vi.fn(),
    useNavigation: vi.fn(() => ({ state: "idle" })),
    useLocation: vi.fn(() => ({
      pathname: "/bookings/booking-1/overview/fulfil-and-checkout",
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
// DOM for the live code scanner — no value here, and stubbing avoids pulling
// the full scanner module graph into the test.
vi.mock("~/components/scanner/code-scanner", () => ({
  useGlobalModeViaObserver: () => "scanner",
}));

// why: ListHeader uses `useStickyHeaderPortal`, whose mount effect reads
// `thead.rows[0].cells` — fine in a browser, but happy-dom's HTMLCollection
// crashes the render.
vi.mock("~/components/list/list-header", () => ({
  ListHeader: ({ children }: { children: any }) => (
    <thead>
      <tr>{children}</tr>
    </thead>
  ),
}));

// why: Radix AlertDialog portals don't settle in happy-dom. The check-out
// dialog's trigger button is what these tests locate, and the units it would
// ask the operator to confirm are exposed on it; the dialog body is not
// asserted against.
vi.mock("~/components/booking/checkout-dialog", () => ({
  __esModule: true,
  default: ({
    disabled,
    unassignedUnits,
  }: {
    disabled?: boolean;
    unassignedUnits?: Array<{ name: string; count: number }>;
  }) => (
    <button
      type="submit"
      disabled={disabled}
      data-unassigned={JSON.stringify(unassignedUnits ?? [])}
    >
      Check out
    </button>
  ),
  CheckoutIntentEnum: {
    WITH_ADJUSTED_DATE: "with-adjusted-date",
    WITHOUT_ADJUSTED_DATE: "without-adjusted-date",
  },
}));

const useRouteLoaderDataMock = vi.mocked(useRouteLoaderData);

/** Builds `n` outstanding reservations, none of them fulfilled yet. */
function makeExpectedModels(n: number): ExpectedModelRequest[] {
  return Array.from({ length: n }, (_, i) => ({
    assetModelId: `model-${i}`,
    assetModelName: `Matthews 24" x 36" Black Flag ${i}`,
    booked: 4,
    remaining: 4,
  }));
}

/** An item already on the booking, as the loader lists it. */
const ALREADY_ON_BOOKING: Exclude<
  FulfilSessionInfo,
  null
>["alreadyIncluded"][number] = {
  id: "asset-tripod",
  title: "Tripod",
  mainImage: null,
  thumbnailImage: null,
  assetModelId: null,
  kitId: null,
  bookedQuantity: 1,
  type: "INDIVIDUAL",
};

/** One member of a scanned kit, as `KIT_INCLUDE` selects it. */
type KitMember = KitFromQr["assetKits"][number]["asset"];

/**
 * A resolved kit payload, as the scanned-item endpoint responds with it.
 *
 * @param id - Kit id; what the form submits.
 * @param name - Rendered in the kit row.
 * @param members - Its assets. `assetModelId` is what decides whether a
 *   member assigns an outstanding reservation.
 */
function makeKit({
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
    _count: { assetKits: members.length },
    assetKits: members.map((member, index) => ({
      id: `${id}-membership-${index}`,
      quantity: 1,
      asset: {
        status: "AVAILABLE",
        availableToBook: true,
        // `KIT_INCLUDE` selects custody as a relation list, so an unheld
        // member is an empty array rather than null.
        custody: [],
        ...member,
      },
    })) as KitFromQr["assetKits"],
  };
}

/**
 * Mounts the drawer with a seeded fulfil session for `modelCount` models.
 *
 * @param options.alreadyIncluded - Items already on the booking.
 * @param options.checksOutScannedOnly - Whether submit sends out scans only.
 * @param options.scannedAssets - Resolved asset scans, keyed by their QR id.
 * @param options.scannedKits - Resolved kit scans, keyed by their QR id.
 */
function renderDrawer(
  modelCount: number,
  options: {
    alreadyIncluded?: Exclude<FulfilSessionInfo, null>["alreadyIncluded"];
    checksOutScannedOnly?: boolean;
    scannedAssets?: Record<string, Partial<AssetFromQr>>;
    scannedKits?: Record<string, Partial<KitFromQr>>;
  } = {}
) {
  const store = createStore();
  const expectedModelRequests = makeExpectedModels(modelCount);

  store.set(fulfilSessionAtom, {
    bookingId: "booking-1",
    bookingName: "Nishanth",
    bookingFrom: new Date("2099-01-01T10:00:00Z").toISOString(),
    bookingStatus: "RESERVED",
    checksOutScannedOnly: options.checksOutScannedOnly ?? false,
    expectedModelRequests,
    alreadyIncluded: options.alreadyIncluded ?? [],
  });
  store.set(expectedModelRequestsAtom, expectedModelRequests);
  store.set(scannedItemsAtom, {
    ...Object.fromEntries(
      Object.entries(options.scannedAssets ?? {}).map(([qrId, asset]) => [
        qrId,
        { type: "asset" as const, data: asset as AssetFromQr },
      ])
    ),
    ...Object.fromEntries(
      Object.entries(options.scannedKits ?? {}).map(([qrId, kit]) => [
        qrId,
        { type: "kit" as const, data: kit as KitFromQr },
      ])
    ),
  });

  return render(
    <Provider store={store}>
      <FulfilReservationsDrawer />
    </Provider>
  );
}

/** The drawer's scrolling item list — the only scroll container in the body. */
function getScrollingList(): HTMLElement {
  const list = document.querySelector<HTMLElement>(".overflow-y-scroll");
  if (!list) {
    throw new Error("Drawer body scroll container not found");
  }
  return list;
}

/**
 * The per-model list as it exists in the DOM, independent of the accessibility
 * tree.
 *
 * `queryByRole` treats a `hidden` attribute as absent, so it reports a folded
 * list even when the element still renders — which is exactly what a `display`
 * utility does to `hidden`, since the attribute's `display: none` comes from
 * the base layer and any utility overrides it. Reading the DOM directly is
 * what makes these assertions about what the operator sees.
 */
function queryModelListNode(): HTMLElement | null {
  return document.getElementById("fulfil-model-progress-list");
}

/** The summary row that folds and unfolds the per-model progress strips. */
function getModelsToggle(): HTMLElement {
  return screen.getByRole("button", { name: /models? reserved/ });
}

/** Opens the fold so the per-model strips are in the accessibility tree. */
async function unfoldModels() {
  const toggle = getModelsToggle();
  if (toggle.getAttribute("aria-expanded") === "false") {
    await userEvent.setup().click(toggle);
  }
}

describe("FulfilReservationsDrawer layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouteLoaderDataMock.mockReturnValue({
      minimizedSidebar: false,
    } as never);
  });

  it("keeps the check-out form out of the scrolling item list", () => {
    // The form is the drawer's whole purpose. Inside the scroll container it
    // sits below every row, so a booking with dozens of reserved models can
    // push it out of view with no way back to it.
    renderDrawer(40);

    const checkoutButton = screen.getByRole("button", { name: "Check out" });

    expect(checkoutButton).toBeTruthy();
    expect(getScrollingList().contains(checkoutButton)).toBe(false);
  });

  it("lets the header yield height so the pinned action cannot be pushed off", () => {
    // Handle, title bar and footer are shrink-0 and the body has a zero basis,
    // so a drawer clamped below its chrome height has to take the deficit out
    // of the header. Anywhere else and the check-out button renders past the
    // bottom of a `fixed` box, unreachable and unscrollable — the very failure
    // this drawer was changed to fix. happy-dom does no layout, so this pins
    // the shrink/scroll contract that produces the behaviour.
    renderDrawer(40);

    const headerWrapper = getModelsToggle().closest(".overflow-y-auto");

    expect(headerWrapper).not.toBeNull();
    expect(headerWrapper?.className).toContain("shrink");
    expect(headerWrapper?.className).not.toContain("shrink-0");
    expect(headerWrapper?.className).toContain("min-h-0");
  });

  it("gives the per-model progress list its own scroll", async () => {
    // Without this the header grows without limit — 40 models render taller
    // than the viewport, and the drawer takes the whole screen with it.
    renderDrawer(40);
    await unfoldModels();

    const modelList = screen.getByRole("list");

    expect(modelList.className).toContain("overflow-y-auto");
    expect(modelList.className).toContain("max-h-[176px]");
  });

  it("renders every reserved model, so nothing is silently dropped", async () => {
    renderDrawer(40);
    await unfoldModels();

    expect(screen.getByRole("list").children).toHaveLength(40);
  });

  describe("folding the model list", () => {
    it("starts folded when the list is long enough to need its own scroll", () => {
      // Fixed chrome competes with the scan list for one screen. A list that
      // cannot be read at a glance is not worth the height by default.
      renderDrawer(40);

      expect(queryModelListNode()).toBeNull();
      expect(getModelsToggle()).toHaveAttribute("aria-expanded", "false");
    });

    it("starts open when the whole list is visible at once", () => {
      renderDrawer(3);

      expect(queryModelListNode()?.children).toHaveLength(3);
      expect(getModelsToggle()).toHaveAttribute("aria-expanded", "true");
    });

    it("folds and unfolds on demand", async () => {
      const user = userEvent.setup();
      renderDrawer(3);

      await user.click(getModelsToggle());
      // Asserted against the DOM, not the a11y tree: a list that is merely
      // marked hidden still occupies the drawer.
      expect(queryModelListNode()).toBeNull();

      await user.click(getModelsToggle());
      expect(queryModelListNode()?.children).toHaveLength(3);
    });

    it("keeps overall progress visible while folded", () => {
      // Folding hides the per-model detail, never the fact of progress. The
      // totals span every reserved model, not just the ones on screen.
      renderDrawer(40);

      // 40 models x 4 booked units each, none scanned yet.
      expect(getModelsToggle()).toHaveTextContent("40 models reserved");
      expect(getModelsToggle()).toHaveTextContent("0 / 160");
    });
  });
});

/**
 * A check-out needs at least one item to go out, and nothing more. Reserved
 * units still unassigned are confirmed by the operator and stay open on the
 * booking; they never keep the button disabled.
 */
describe("FulfilReservationsDrawer check-out rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouteLoaderDataMock.mockReturnValue({
      minimizedSidebar: false,
    } as never);
  });

  it("offers check-out while reserved units are unassigned, once an item would go out", () => {
    // Two models x 4 units, nothing scanned; the booking already holds a
    // tripod, and the whole booking goes out.
    renderDrawer(2, { alreadyIncluded: [ALREADY_ON_BOOKING] });

    const checkoutButton = screen.getByRole("button", { name: "Check out" });

    expect(checkoutButton).toBeEnabled();
    expect(screen.getByText("8 reserved units still unassigned")).toBeTruthy();
    // The confirmation names every model with units still to assign.
    expect(JSON.parse(checkoutButton.dataset.unassigned ?? "[]")).toEqual([
      { name: 'Matthews 24" x 36" Black Flag 0', count: 4 },
      { name: 'Matthews 24" x 36" Black Flag 1', count: 4 },
    ]);
  });

  it("keeps check-out disabled while nothing would go out", () => {
    renderDrawer(2);

    expect(screen.getByRole("button", { name: "Check out" })).toBeDisabled();
    expect(
      screen.getByText("Scan at least one item to check out")
    ).toBeTruthy();
  });

  it("requires a scan when only scanned items go out, even with items on the booking", () => {
    renderDrawer(2, {
      alreadyIncluded: [ALREADY_ON_BOOKING],
      checksOutScannedOnly: true,
    });

    expect(screen.getByRole("button", { name: "Check out" })).toBeDisabled();
  });

  it("checks out an item already on the booking by scanning it, when only scanned items go out", () => {
    renderDrawer(2, {
      alreadyIncluded: [ALREADY_ON_BOOKING],
      checksOutScannedOnly: true,
      scannedAssets: {
        "qr-tripod": {
          id: "asset-tripod",
          title: "Tripod",
          type: "INDIVIDUAL",
          assetModelId: null,
          mainImage: null,
          thumbnailImage: null,
        },
      },
    });

    expect(screen.getByRole("button", { name: "Check out" })).toBeEnabled();
    expect(screen.getByText("Ready to check out")).toBeTruthy();
    expect(document.querySelector('input[name="assetIds[0]"]')).toHaveAttribute(
      "value",
      "asset-tripod"
    );
  });
});

/** Values of the hidden inputs the form would submit under `field`. */
function submittedValues(field: "assetIds" | "kitIds"): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[name^="${field}["]`)
  ).map((input) => input.value);
}

/**
 * A scanned kit goes on the booking whole, and its INDIVIDUAL members assign
 * outstanding reserved units on the way. The kit id is what the form sends —
 * members are never submitted as loose asset ids.
 */
describe("FulfilReservationsDrawer kit scans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // why: the drawer renders inside the app shell, which reads the layout
    // route's loader for the sidebar state. Nothing here exercises that, but
    // without it the shell throws before any row is rendered.
    useRouteLoaderDataMock.mockReturnValue({
      minimizedSidebar: false,
    } as never);
  });

  it("assigns a reserved unit from a scanned kit's member", () => {
    renderDrawer(1, {
      scannedKits: {
        "qr-grip-kit": makeKit({
          id: "kit-grip",
          name: "Grip Kit",
          members: [
            { id: "asset-flag", type: "INDIVIDUAL", assetModelId: "model-0" },
          ],
        }),
      },
    });

    expect(screen.getByText("Grip Kit")).toBeTruthy();
    expect(screen.getByText("Assigns 1 reserved unit")).toBeTruthy();
    // The member advances the very strip a loose scan of it would.
    expect(getModelsToggle()).toHaveTextContent("1 / 4");
    expect(screen.getByText("3 reserved units still unassigned")).toBeTruthy();

    expect(screen.getByRole("button", { name: "Check out" })).toBeEnabled();
    expect(submittedValues("kitIds")).toEqual(["kit-grip"]);
    // The server resolves the kit into kit-driven rows. A member sent as a
    // loose id as well would land on the booking twice.
    expect(submittedValues("assetIds")).toEqual([]);
  });

  it("blocks a loose scan of a unit that belongs to a kit", () => {
    renderDrawer(1, {
      scannedAssets: {
        "qr-member": {
          id: "asset-member",
          title: "Camera A",
          type: "INDIVIDUAL",
          assetModelId: "model-0",
          // Committed to a kit that this scan does not name.
          assetKits: [{ id: "ak-1", kitId: "kit-9" }],
        } as never,
      },
    });

    expect(screen.getByText(/belongs to a kit/i)).toBeInTheDocument();
    // Sending one member out alone would answer the reservation and check the
    // booking out with the kit split, so submit is refused until it is removed.
    expect(screen.getByRole("button", { name: /check out/i })).toBeDisabled();
  });

  it("does not block the member when its kit is scanned too", () => {
    renderDrawer(1, {
      scannedAssets: {
        "qr-member": {
          id: "asset-member",
          title: "Camera A",
          type: "INDIVIDUAL",
          assetModelId: "model-0",
          assetKits: [{ id: "ak-1", kitId: "kit-9" }],
        } as never,
      },
      scannedKits: {
        "qr-kit": makeKit({
          id: "kit-9",
          name: "Kit Nine",
          members: [
            {
              id: "asset-member",
              type: "INDIVIDUAL",
              assetModelId: "model-0",
            } as never,
          ],
        }),
      },
    });

    expect(screen.queryByText(/belongs to a kit/i)).not.toBeInTheDocument();
  });

  it("renders and submits a kit whose members assign nothing", () => {
    renderDrawer(1, {
      scannedKits: {
        "qr-cable-kit": makeKit({
          id: "kit-cable",
          name: "Cable Kit",
          members: [
            // Off-model, and a quantity-tracked member of a reserved model:
            // a slice of a pool is not the whole unit a reservation books.
            { id: "asset-cable", type: "INDIVIDUAL", assetModelId: null },
            {
              id: "asset-sandbags",
              type: "QUANTITY_TRACKED",
              assetModelId: "model-0",
            },
          ],
        }),
      },
    });

    expect(screen.getByText("Cable Kit")).toBeTruthy();
    expect(
      screen.getByText("Will be added to booking and checked out")
    ).toBeTruthy();
    expect(getModelsToggle()).toHaveTextContent("0 / 4");

    // Matching nothing is not an error — the kit still goes out.
    expect(screen.getByRole("button", { name: "Check out" })).toBeEnabled();
    expect(submittedValues("kitIds")).toEqual(["kit-cable"]);
  });

  it("lets one asset assign one unit, however many ways it was scanned", () => {
    renderDrawer(1, {
      scannedAssets: {
        "qr-flag": {
          id: "asset-flag",
          title: "Black Flag",
          type: "INDIVIDUAL",
          assetModelId: "model-0",
          mainImage: null,
          thumbnailImage: null,
        },
      },
      scannedKits: {
        "qr-grip-kit": makeKit({
          id: "kit-grip",
          name: "Grip Kit",
          members: [
            { id: "asset-flag", type: "INDIVIDUAL", assetModelId: "model-0" },
          ],
        }),
      },
    });

    expect(getModelsToggle()).toHaveTextContent("1 / 4");
    // The kit owns the assignment, matching the server: it drops the loose
    // scan and books the unit through the kit slice, because both rows would
    // book one physical camera twice.
    expect(screen.getByText("Assigns 1 reserved unit")).toBeTruthy();
    // So the asset's own row reports where it arrives from rather than
    // claiming a unit of its own — one camera, one reserved unit.
    expect(screen.getByText("Arrives with Grip Kit")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    // Both still submit: the server decides which row carries it.
    expect(submittedValues("assetIds")).toEqual(["asset-flag"]);
    expect(submittedValues("kitIds")).toEqual(["kit-grip"]);
  });
});
