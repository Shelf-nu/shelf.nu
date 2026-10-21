/**
 * Tests for {@link AdjustModelReservationDialog}.
 *
 * What is pinned here is the floor: a reservation can never fall below the
 * units already assigned to the booking, and the one-tap way down to exactly
 * that number — which is how an operator gives back units that turned out to
 * be damaged or were never collected.
 *
 * Mocks:
 * - `react-router`'s `useFetcher` — drives fetcher state per test without a
 *   data router; `Form` becomes a plain `<form>` and `submit` is asserted on.
 * - `~/hooks/use-disabled` — stable `false`, so Save is never disabled by
 *   navigation state.
 * - `~/components/shared/modal` — Radix `AlertDialog` portals and manages its
 *   own open state; a plain shell lets the controlled `open` prop drive
 *   visibility (same shape as `adjust-booking-asset-quantity-dialog.test.tsx`).
 *
 * @see {@link file://./adjust-model-reservation-dialog.tsx}
 */

import type React from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustModelReservationDialog } from "./adjust-model-reservation-dialog";

/** Mutable per-test fetcher state, reassigned in `beforeEach`. */
type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { success?: boolean; error?: { message?: string } | null } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };
let mockSubmit = vi.fn();

// why: useFetcher returns a Form component plus state we need to drive per
// test, and a `submit` the happy path is asserted against.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
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

// why: useDisabled reads navigation/fetcher plumbing; stabilise to `false` so
// Save is always clickable here.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: AlertDialog portals its content and gates on internally-managed state.
// A plain shell makes the controlled `open` prop drive visibility directly.
vi.mock("~/components/shared/modal", () => {
  const AlertDialog = ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => <>{open ? children : null}</>;
  const passthrough = ({ children }: { children: ReactNode }) => (
    <>{children}</>
  );
  return {
    AlertDialog,
    AlertDialogTrigger: passthrough,
    AlertDialogContent: ({ children }: { children: ReactNode }) => (
      <div role="alertdialog">{children}</div>
    ),
    AlertDialogHeader: passthrough,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogFooter: passthrough,
    AlertDialogCancel: passthrough,
  };
});

/** Renders the dialog open, with ten reserved and `assigned` on the booking. */
function renderDialog({
  quantity = 10,
  fulfilledQuantity = 8,
  onOpenChange = vi.fn(),
}: {
  quantity?: number;
  fulfilledQuantity?: number;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  // A fresh element each time: React bails out of re-rendering when handed the
  // identical element reference, which would swallow the replay below.
  const element = () => (
    <AdjustModelReservationDialog
      bookingId="booking-1"
      assetModelId="model-1"
      modelName="Dell Latitude 5550"
      quantity={quantity}
      fulfilledQuantity={fulfilledQuantity}
      open
      onOpenChange={onOpenChange}
    />
  );
  const { rerender } = render(element());

  /**
   * Replays the render with whatever `mockFetcherState` now says, which is how
   * a test walks the dialog through a submission: busy, then idle carrying the
   * server's answer.
   */
  return { onOpenChange, replay: () => rerender(element()) };
}

/** Puts the fetcher mid-flight. */
function startSubmitting() {
  mockFetcherState = { state: "submitting", data: undefined };
}

/** Lands the server's answer. */
function settleWith(data: FetcherState["data"]) {
  mockFetcherState = { state: "idle", data };
}

function quantityField() {
  return screen.getByLabelText(/reserved units/i) as HTMLInputElement;
}

describe("AdjustModelReservationDialog", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
    mockSubmit = vi.fn();
  });

  it("opens on what the booking reserves now", () => {
    renderDialog();

    expect(quantityField().value).toBe("10");
    expect(screen.getByText(/8 of 10 units assigned so far/i)).toBeTruthy();
  });

  it("releases the unassigned remainder in one tap", () => {
    renderDialog();

    fireEvent.click(
      screen.getByRole("button", {
        name: /release the 2 units still unassigned/i,
      })
    );

    // Down to exactly what went out: the two that never turned up go back to
    // the pool, and the reservation closes.
    expect(quantityField().value).toBe("8");
  });

  it("offers no release shortcut when nothing has been assigned", () => {
    // Releasing everything means cancelling the reservation, which is the row
    // menu's Remove — offering it here would post a quantity of zero.
    renderDialog({ quantity: 4, fulfilledQuantity: 0 });

    expect(screen.queryByRole("button", { name: /release/i })).toBeNull();
  });

  it("refuses to go below the units already assigned", () => {
    renderDialog();

    fireEvent.change(quantityField(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/8 is the lowest this can go/i)).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("posts the new quantity to the model-requests endpoint", () => {
    renderDialog();

    fireEvent.change(quantityField(), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mockSubmit).toHaveBeenCalledWith(
      { assetModelId: "model-1", quantity: "8" },
      expect.objectContaining({
        method: "POST",
        action: "/api/bookings/booking-1/model-requests",
      })
    );
  });

  it("shows the server's refusal instead of closing", () => {
    const { onOpenChange, replay } = renderDialog();

    startSubmitting();
    replay();
    settleWith({
      error: { message: "Only 9 can be reserved in this window." },
    });
    replay();

    expect(
      screen.getByText(/only 9 can be reserved in this window/i)
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on a success payload that carries a null error", () => {
    // The route's `payload()` helper stamps `error: null` onto every success,
    // so an `"error" in data` test would keep the dialog open forever.
    const { onOpenChange, replay } = renderDialog();

    startSubmitting();
    replay();
    settleWith({ success: true, error: null });
    replay();

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores the result of an earlier save when it opens again", () => {
    // A keyed fetcher keeps its last result for as long as it stays mounted,
    // so a dialog that closed on "a successful result exists" would slam shut
    // the moment the operator reopened it.
    settleWith({ success: true, error: null });
    const { onOpenChange } = renderDialog();

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not re-show an earlier refusal when it opens again", () => {
    settleWith({
      error: { message: "Only 9 can be reserved in this window." },
    });
    renderDialog();

    expect(screen.queryByText(/only 9 can be reserved/i)).toBeNull();
  });
});
