/**
 * AssetStatusBadge — unit tests
 *
 * Verifies the rendering contract of the asset status badge, with a
 * focus on the new `suppressQtyAware` escape hatch used by booking
 * surfaces (booking-row badge cleanup):
 *
 *  - When the caller opts out via `suppressQtyAware`, the global
 *    qty-aware breakdown (custody/other-booking inference into
 *    "Partial custody" / "Partially checked out" relabels) is bypassed
 *    for QUANTITY_TRACKED assets — the caller-supplied `status` wins.
 *  - Booking-context pseudo-statuses (e.g. `PARTIALLY_CHECKED_OUT_QTY`)
 *    still render with their dedicated label + color in the suppressed
 *    path — the underlying `userFriendlyAssetStatus` /
 *    `assetStatusColorMap` mapping carries the violet pseudo-status
 *    treatment regardless of which branch renders it.
 *  - When `suppressQtyAware` is left at its default (`false`), the
 *    qty-aware branch remains active for QT assets (hover-card +
 *    "Partially checked out"/"Partial custody" relabels), but only when
 *    the inline breakdown is COMPLETE — i.e. it ships `bookingAssets`.
 *    Index / picker / scanner-drawer fragments ship custody without
 *    booking slices, so the badge renders the caller status until the
 *    lazy `/quantity-breakdown` fetch resolves, and once resolved the
 *    lazy data wins over the incomplete inline snapshot (issue #2875:
 *    the index must not infer "Partial custody" while units are out on
 *    a booking).
 *  - When `suppressQtyAware` is set, the lazy
 *    `/api/assets/:id/quantity-breakdown` fetch is skipped — booking
 *    rows render 50+ rows at a time and must not fan out per-row HTTP
 *    requests on cursor enter.
 *  - For INDIVIDUAL assets the flag is a no-op (the
 *    `isQuantityTracked` check already short-circuits the qty-aware
 *    branch for non-QT assets).
 *
 * @see {@link file://./asset-status-badge.tsx}
 */

import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AssetStatusBadge } from "./asset-status-badge";
import type { QuantityAwareAsset } from "./quantity-data";

/**
 * Captures calls into the `useApiQuery` hook so each test can assert
 * whether the qty-breakdown endpoint was queried. The hook returns
 * `{ data: undefined }` so the badge renders its initial (pre-fetch)
 * state — exactly what booking rows render on first paint.
 */
const apiQueryCalls: Array<{ api: string; enabled: boolean }> = [];

/**
 * Injectable response for the `/api/assets/:id/quantity-breakdown` endpoint.
 * Tests set this to simulate a resolved lazy breakdown (the endpoint applies
 * the effective checked-out math index fragments can't).
 */
let mockBreakdownData: QuantityAwareAsset | undefined;

// why: AssetStatusBadge uses `useApiQuery` for two endpoints
// (`/api/assets/:id/quantity-breakdown` and
// `/api/assets/:id/ongoing-booking`). We mock the hook so the test
// runs without a network/loader, and so we can introspect the call
// shape — case (d) below asserts the breakdown endpoint is NEVER
// enabled when `suppressQtyAware` is set on a QT asset.
vi.mock("~/hooks/use-api-query", () => ({
  default: ({ api, enabled }: { api: string; enabled?: boolean }) => {
    apiQueryCalls.push({ api, enabled: !!enabled });
    return {
      data: api.includes("/quantity-breakdown") ? mockBreakdownData : undefined,
      isLoading: false,
      error: undefined,
    };
  },
}));

// why: Radix HoverCard relies on `ResizeObserver` and complex portal
// pointer-events plumbing that happy-dom doesn't fully simulate. We
// only need the trigger (Badge text) to render — wrap the Radix
// components in passthrough renderers so the badge text reaches the
// DOM without needing to drive the hover lifecycle.
vi.mock("../../shared/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@radix-ui/react-hover-card", () => ({
  HoverCardPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// why: the tooltip renders booking links via react-router `Link`, which
// needs router context the badge unit test doesn't set up. The tooltip
// content is exercised by its own tests; here we only need the badge's
// label/relabel contract.
vi.mock("./quantity-tooltip-content", () => ({
  QuantityTooltipContent: ({ data }: { data: { total: number } }) => (
    <div data-testid="quantity-tooltip">{data.total}</div>
  ),
}));

beforeEach(() => {
  apiQueryCalls.length = 0;
  mockBreakdownData = undefined;
});

/**
 * Builds a minimal QT asset shape carrying a custody slice so the
 * default (non-suppressed) qty-aware branch would produce a "Partial
 * custody" relabel — used to prove that `suppressQtyAware` overrides
 * that inference.
 */
function makeQtAssetWithCustodyElsewhere(): QuantityAwareAsset {
  return {
    type: "QUANTITY_TRACKED",
    quantity: 10,
    // Custody held by someone else on the global asset; without
    // suppression this would relabel an AVAILABLE row to "Partial
    // custody" via `getQuantityBadgeLabelAndColor`.
    custody: [{ quantity: 4 }],
    bookingAssets: [],
    assetKits: [],
  };
}

/**
 * Builds the issue-#2875 repro shape: an asset with units both in
 * custody and checked out on an ONGOING booking — as shipped by the
 * asset detail page loader (full `bookingAssets`, effective quantities
 * pre-applied) and by the `/quantity-breakdown` lazy endpoint.
 */
function makeQtAssetInCustodyAndCheckedOut(): QuantityAwareAsset {
  return {
    type: "QUANTITY_TRACKED",
    quantity: 29,
    custody: [{ quantity: 20 }],
    bookingAssets: [
      {
        quantity: 5,
        assetKitId: null,
        booking: { id: "booking-1", name: "Q3 event", status: "ONGOING" },
      },
    ],
    assetKits: [],
  };
}

/** Cursor-enter on the badge trigger span, arming the lazy fetch path. */
function hoverBadge(container: HTMLElement) {
  const root = container.querySelector("span");
  if (root) fireEvent.mouseEnter(root);
}

const breakdownCalls = () =>
  apiQueryCalls.filter((call) => call.api.includes("/quantity-breakdown"));

describe("AssetStatusBadge", () => {
  describe("suppressQtyAware (booking-row escape hatch)", () => {
    it("renders 'Available' for an AVAILABLE QT row even when global custody would infer 'Partial custody'", () => {
      // Case (a): the booking-row use case. The caller knows this row
      // is AVAILABLE for THIS booking; the global custody slice on the
      // pooled asset must not bleed in as "Partial custody".
      render(
        <AssetStatusBadge
          id="asset-qt-1"
          status="AVAILABLE"
          availableToBook
          suppressQtyAware
          asset={makeQtAssetWithCustodyElsewhere()}
        />
      );

      expect(screen.getByText("Available")).toBeInTheDocument();
      expect(screen.queryByText(/partial custody/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/partially checked out/i)
      ).not.toBeInTheDocument();
    });

    it("renders the violet 'Partially checked out' pseudo-status for PARTIALLY_CHECKED_OUT_QTY", () => {
      // Case (b): caller-supplied pseudo-status wins. The dedicated
      // `userFriendlyAssetStatus` mapping converts the pseudo-status
      // into the user-facing "Partially checked out" label with the
      // violet color treatment — and this must survive
      // `suppressQtyAware` because the pseudo-status itself encodes
      // the row's authoritative booking-context state.
      render(
        <AssetStatusBadge
          id="asset-qt-2"
          status="PARTIALLY_CHECKED_OUT_QTY"
          availableToBook
          suppressQtyAware
          asset={makeQtAssetWithCustodyElsewhere()}
        />
      );

      expect(screen.getByText("Partially checked out")).toBeInTheDocument();
    });

    it("does not relabel a custody-only inline snapshot and arms the lazy fetch instead", () => {
      // Case (c): index-surface regression guard (asset index, picker
      // rows, scanner drawer). Those loaders ship custody but no
      // `bookingAssets`, so the inline breakdown is INCOMPLETE: reading
      // it as authoritative would report `checkedOut = 0` and infer
      // "Partial custody" even when units are out on a booking
      // (issue #2875). The badge must render the caller status until
      // the lazy `/quantity-breakdown` fetch resolves, and must arm
      // that fetch on hover.
      const { container } = render(
        <AssetStatusBadge
          id="asset-qt-3"
          status="AVAILABLE"
          availableToBook
          asset={makeQtAssetWithCustodyElsewhere()}
        />
      );

      expect(screen.getByText("Available")).toBeInTheDocument();
      expect(screen.queryByText(/partial custody/i)).not.toBeInTheDocument();

      hoverBadge(container);
      expect(breakdownCalls().some((call) => call.enabled)).toBe(true);
    });

    it("prefers the lazy breakdown over an incomplete custody-only inline snapshot once it resolves", () => {
      // Case (d): the issue-#2875 repro. The index ships custody-only
      // inline data; the lazy endpoint resolves with the booking slices
      // (5 checked out) and the badge must converge to the same label
      // as the asset detail page — "Partially checked out".
      mockBreakdownData = makeQtAssetInCustodyAndCheckedOut();

      const { container } = render(
        <AssetStatusBadge
          id="asset-qt-3"
          status="AVAILABLE"
          availableToBook
          asset={makeQtAssetWithCustodyElsewhere()}
        />
      );

      expect(screen.getByText("Partially checked out")).toBeInTheDocument();
      expect(screen.queryByText(/partial custody/i)).not.toBeInTheDocument();

      hoverBadge(container);
      expect(breakdownCalls().some((call) => call.enabled)).toBe(true);
    });

    it("keeps inline data authoritative when it ships booking slices (asset detail page)", () => {
      // Case (e): the asset detail page ships the full `bookingAssets`
      // with effective quantities pre-applied — no lazy fetch is armed,
      // and the inline breakdown drives the label directly.
      const { container } = render(
        <AssetStatusBadge
          id="asset-qt-3"
          status="AVAILABLE"
          availableToBook
          asset={makeQtAssetInCustodyAndCheckedOut()}
        />
      );

      expect(screen.getByText("Partially checked out")).toBeInTheDocument();

      hoverBadge(container);
      expect(breakdownCalls().every((call) => call.enabled === false)).toBe(
        true
      );
    });

    it("does not enable the lazy /quantity-breakdown fetch when suppressQtyAware is set on a QT asset", () => {
      // Case (f): perf guard. Booking rows render many QT assets at
      // once; enabling the lazy fetch (even on hover) would fan out
      // one HTTP request per row. The asset has NO inline
      // `bookingAssets`, so without suppression the badge would arm
      // the lazy fetch onMouseEnter.
      const { container } = render(
        <AssetStatusBadge
          id="asset-qt-4"
          status="AVAILABLE"
          availableToBook
          suppressQtyAware
          asset={{
            type: "QUANTITY_TRACKED",
            quantity: 5,
            custody: null,
            bookingAssets: null,
            assetKits: null,
          }}
        />
      );

      // Fire the cursor-enter event that would normally arm the lazy
      // fetch — we want to prove suppression survives it.
      hoverBadge(container);
      // The hook is invoked unconditionally (React rules of hooks),
      // but it must NEVER be `enabled` for a suppressed QT row.
      expect(breakdownCalls().every((call) => call.enabled === false)).toBe(
        true
      );
    });

    it("is a no-op for INDIVIDUAL assets (the qty-aware branch never applied to them)", () => {
      // Case (g): defensive — flipping the flag on an INDIVIDUAL
      // asset must not change the rendered output. INDIVIDUAL assets
      // always render via the standard status path.
      const individualAsset: QuantityAwareAsset = {
        type: "INDIVIDUAL",
        quantity: 1,
        custody: null,
        bookingAssets: [],
        assetKits: [],
      };

      const { rerender } = render(
        <AssetStatusBadge
          id="asset-ind-1"
          status="AVAILABLE"
          availableToBook
          asset={individualAsset}
        />
      );
      expect(screen.getByText("Available")).toBeInTheDocument();

      // Flip the flag — output must stay identical.
      rerender(
        <AssetStatusBadge
          id="asset-ind-1"
          status="AVAILABLE"
          availableToBook
          suppressQtyAware
          asset={individualAsset}
        />
      );
      expect(screen.getByText("Available")).toBeInTheDocument();
    });
  });
});
