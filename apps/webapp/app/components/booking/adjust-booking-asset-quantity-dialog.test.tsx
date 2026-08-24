/**
 * Smoke tests for {@link AdjustBookingAssetQuantityDialog}.
 *
 * Covers the windowed-max messaging fix: the dialog used to show
 * `Max: {asset.quantity}` (the workspace TOTAL) with no explanation. It now
 * accepts an optional `totalQuantity` (booking context) that switches the
 * helper copy to "Available for these dates: {maxQuantity} of
 * {totalQuantity}" plus a "reserved by other bookings" note when
 * `reservedByOthers > 0`. The custody-list usage never passes
 * `totalQuantity`, so it must keep rendering the original "Max: N" copy
 * unchanged.
 *
 * Mocks:
 * - `react-router`'s `useFetcher` — so we can drive fetcher state per test
 *   without a data router; `Form` is swapped for a plain `<form>` whose
 *   submit is captured by `mockSubmit`.
 * - `~/hooks/use-disabled` — stable `false` so the Save button is never
 *   disabled by navigation state.
 * - `~/components/shared/modal` — Radix `AlertDialog` portals content and
 *   gates on internally-managed state; swapped for a simple
 *   `open ? children : null` shell (mirrors `move-units-dialog.test.tsx`).
 *
 * @see {@link file://./adjust-booking-asset-quantity-dialog.tsx}
 */

import type React from "react";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustBookingAssetQuantityDialog } from "./adjust-booking-asset-quantity-dialog";

/** Mutable per-test fetcher state, reassigned in `beforeEach`. */
type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { success?: boolean; error?: { message?: string } } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };
let mockSubmit = vi.fn();
/** Controls the viewer's role (owner vs self-service/base) per test. */
const mockUseUserRoleHelper = vi.fn(() => ({ isBaseOrSelfService: false }));

// why: useFetcher returns a Form component + state we need to control per
// test, and a `submit` we assert against for the happy-path case.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    // why: the real <Link> needs a Router context we don't set up here; render
    // a plain <a> so the owner "View bookings" link is queryable by href.
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children: ReactNode;
      [key: string]: unknown;
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useFetcher: () => ({
      ...mockFetcherState,
      Form: ({
        children,
        onSubmit,
        ...rest
      }: {
        children: ReactNode;
        onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
        [key: string]: unknown;
      }) => (
        <form {...rest} onSubmit={onSubmit}>
          {children}
        </form>
      ),
      submit: mockSubmit,
    }),
  };
});

// why: useDisabled depends on useNavigation/fetcher plumbing; stabilise to
// `false` so the Save button is always clickable in these tests.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: the dialog calls useUserRoleHelper (which reads route loader data) to
// decide whether to show the owner-only "View bookings" link; mock it so tests
// pick the role without a full data-router context.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => mockUseUserRoleHelper(),
}));

// why: AlertDialog from `~/components/shared/modal` uses Radix's portal +
// internally-managed open state. Swap for a simple shell so the controlled
// `open` prop directly drives visibility, matching the pattern in
// `move-units-dialog.test.tsx`.
vi.mock("~/components/shared/modal", () => {
  const AlertDialog = ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => <>{open ? children : null}</>;
  const AlertDialogTrigger = ({ children }: { children: ReactNode }) => (
    <>{children}</>
  );
  const AlertDialogContent = ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  );
  const AlertDialogHeader = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  const AlertDialogTitle = ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  );
  const AlertDialogDescription = ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  );
  const AlertDialogFooter = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  const AlertDialogCancel = ({ children }: { children: ReactNode }) => (
    <>{children}</>
  );
  return {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
  };
});

describe("AdjustBookingAssetQuantityDialog", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
    mockSubmit = vi.fn();
    // Default: owner (can view other bookings). Individual tests override.
    mockUseUserRoleHelper.mockReturnValue({ isBaseOrSelfService: false });
  });

  describe("booking context (totalQuantity provided)", () => {
    it('leads with "3 of 10 items available" (not the old "Max: N" copy)', () => {
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          assetTitle="Chairs"
          currentQuantity={2}
          maxQuantity={3}
          totalQuantity={10}
          reservedByOthers={7}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(screen.getByText(/3 of 10 units available/i)).toBeInTheDocument();
      expect(screen.queryByText(/^Max: 3/)).not.toBeInTheDocument();
    });

    it('shows the owner "reserved by other bookings" note + View bookings link when reservedByOthers > 0', () => {
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          currentQuantity={2}
          maxQuantity={3}
          totalQuantity={10}
          reservedByOthers={7}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(
        screen.getByRole("alertdialog").textContent?.replace(/\s+/g, " ")
      ).toContain("reserved by other bookings");
      const link = screen.getByRole("link", { name: /View bookings/i });
      expect(link).toHaveAttribute("href", "/assets/asset-1/bookings");
      // Opens in a new tab so the user keeps their place in the adjust dialog.
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("shows the generic note WITHOUT a link for self-service/base users", () => {
      mockUseUserRoleHelper.mockReturnValue({ isBaseOrSelfService: true });
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          currentQuantity={2}
          maxQuantity={3}
          totalQuantity={10}
          reservedByOthers={7}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(
        screen.getByText(/Some units are also reserved by other bookings\./i)
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /View bookings/i })
      ).not.toBeInTheDocument();
    });

    it('does NOT show the "reserved by other bookings" note when reservedByOthers is 0', () => {
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          currentQuantity={2}
          maxQuantity={10}
          totalQuantity={10}
          reservedByOthers={0}
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(
        screen.queryByText(/reserved by other bookings/i)
      ).not.toBeInTheDocument();
    });

    it("allows reducing a quantity that is already above the windowed max", () => {
      // Booking already holds 15 units, but the window now only supports 10
      // (another booking grabbed 5) — the row must stay editable-down.
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          currentQuantity={15}
          maxQuantity={10}
          totalQuantity={20}
          reservedByOthers={10}
          open
          onOpenChange={vi.fn()}
        />
      );

      const quantityInput = screen.getByLabelText(
        /Quantity/i
      ) as HTMLInputElement;
      fireEvent.change(quantityInput, { target: { value: "12" } });

      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("custody usage (no totalQuantity)", () => {
    it('keeps rendering the plain "Max: N" helper', () => {
      render(
        <AdjustBookingAssetQuantityDialog
          bookingId="booking-1"
          assetId="asset-1"
          assetTitle="Chairs"
          currentQuantity={2}
          maxQuantity={10}
          unitOfMeasure="pcs"
          open
          onOpenChange={vi.fn()}
        />
      );

      expect(screen.getByText("Max: 10 pcs")).toBeInTheDocument();
      expect(
        screen.queryByText(/Available for these dates/i)
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/reserved by other bookings/i)
      ).not.toBeInTheDocument();
    });
  });
});
