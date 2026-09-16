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
  expectedModelRequestsAtom,
  fulfilSessionAtom,
} from "~/atoms/qr-scanner";

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
// dialog's trigger button is what these tests locate; the dialog body is not
// asserted against.
vi.mock("~/components/booking/checkout-dialog", () => ({
  __esModule: true,
  default: ({ disabled }: { disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>
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

/** Mounts the drawer with a seeded fulfil session for `modelCount` models. */
function renderDrawer(modelCount: number) {
  const store = createStore();
  const expectedModelRequests = makeExpectedModels(modelCount);

  store.set(fulfilSessionAtom, {
    bookingId: "booking-1",
    bookingName: "Nishanth",
    bookingFrom: new Date("2099-01-01T10:00:00Z").toISOString(),
    expectedModelRequests,
    alreadyIncluded: [],
  });
  store.set(expectedModelRequestsAtom, expectedModelRequests);

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
