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
 *    existing qty-aware branch is preserved for QT assets (hover-card +
 *    "Partial custody"/"Partially checked out" relabels).
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

// why: AssetStatusBadge uses `useApiQuery` for two endpoints
// (`/api/assets/:id/quantity-breakdown` and
// `/api/assets/:id/ongoing-booking`). We mock the hook so the test
// runs without a network/loader, and so we can introspect the call
// shape — case (d) below asserts the breakdown endpoint is NEVER
// enabled when `suppressQtyAware` is set on a QT asset.
vi.mock("~/hooks/use-api-query", () => ({
  default: ({ api, enabled }: { api: string; enabled?: boolean }) => {
    apiQueryCalls.push({ api, enabled: !!enabled });
    return { data: undefined, isLoading: false, error: undefined };
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

beforeEach(() => {
  apiQueryCalls.length = 0;
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

    it("preserves the qty-aware hover-card branch when suppressQtyAware is left at its default (false)", () => {
      // Case (c): regression guard for non-booking surfaces (asset
      // index, asset overview, scanner drawer). With the default
      // (`suppressQtyAware=false`), a QT asset with custody elsewhere
      // must still relabel to "Partial custody" via the qty-aware
      // branch — that's the whole point of the global breakdown.
      render(
        <AssetStatusBadge
          id="asset-qt-3"
          status="AVAILABLE"
          availableToBook
          asset={makeQtAssetWithCustodyElsewhere()}
        />
      );

      expect(screen.getByText("Partial custody")).toBeInTheDocument();
      expect(screen.queryByText("Available")).not.toBeInTheDocument();
    });

    it("does not enable the lazy /quantity-breakdown fetch when suppressQtyAware is set on a QT asset", () => {
      // Case (d): perf guard. Booking rows render many QT assets at
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
      const root = container.querySelector("span");
      if (root) fireEvent.mouseEnter(root);

      const breakdownCalls = apiQueryCalls.filter((call) =>
        call.api.includes("/quantity-breakdown")
      );
      // The hook is invoked unconditionally (React rules of hooks),
      // but it must NEVER be `enabled` for a suppressed QT row.
      expect(breakdownCalls.every((call) => call.enabled === false)).toBe(true);
    });

    it("is a no-op for INDIVIDUAL assets (the qty-aware branch never applied to them)", () => {
      // Case (e): defensive — flipping the flag on an INDIVIDUAL
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
