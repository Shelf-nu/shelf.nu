/**
 * Tests for {@link ModelRequestRowActionsDropdown}: which actions a
 * reservation row offers.
 *
 * The rule pinned here is that a booking already out in the world still lets
 * its reservations be adjusted. Until the quantity comes down, unassigned
 * units keep being counted against every other booking whose window overlaps,
 * so a row that offers nothing on an ONGOING booking strands them there for
 * the rest of the booking.
 *
 * @see {@link file://./model-request-row-actions-dropdown.tsx}
 */
import type { ReactNode } from "react";
import type { BookingStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ModelRequestRowActionsDropdown } from "./model-request-row-actions-dropdown";

// why: the remove form and the adjust dialog both open fetchers, which need a
// data router. These tests cover which actions a row offers, not what they
// post, so an inert fetcher is enough.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      Form: ({ children, ...rest }: { children: ReactNode }) => (
        <form {...rest}>{children}</form>
      ),
      submit: vi.fn(),
    }),
  };
});

// why: useDisabled reads navigation state, which needs a data router; these
// tests never submit, so a stable `false` keeps every control clickable.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: the hook reads the URL through the app's search-param helpers, which
// need a data router's loader data. Forcing the menu open is also what makes
// its items queryable — Radix unmounts closed popover content.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    defaultApplied: true,
    open: true,
    defaultOpen: false,
    setOpen: vi.fn(),
  }),
}));

// why: the component renders a static trigger until hydration, which never
// completes in a bare render; report hydrated so the menu itself renders.
vi.mock("remix-utils/use-hydrated", () => ({
  useHydrated: () => true,
}));

function renderRow({
  bookingStatus,
  fulfilledQuantity = 0,
}: {
  bookingStatus: BookingStatus;
  fulfilledQuantity?: number;
}) {
  return render(
    <MemoryRouter>
      <ModelRequestRowActionsDropdown
        request={{
          assetModelId: "model-1",
          quantity: 10,
          fulfilledQuantity,
          assetModel: { name: "Dell Latitude 5550" },
        }}
        bookingId="booking-1"
        bookingStatus={bookingStatus}
        canManage
        manageAssetsUrl="/bookings/booking-1/overview/manage-assets?hideUnavailable=true"
      />
    </MemoryRouter>
  );
}

describe("ModelRequestRowActionsDropdown", () => {
  it("names its three routes short enough to stay on one line", () => {
    // The menu is a fixed 200px. A label that wraps grows its own row and the
    // list stops reading as a set of equals, which is what "Select assets to
    // assign" did here. There is no way to assert wrapping in happy-dom, so
    // the labels themselves are what is pinned.
    renderRow({ bookingStatus: "RESERVED" });

    expect(
      screen.getByRole("link", { name: /^assign from list$/i })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^scan to assign$/i })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^adjust quantity$/i })
    ).toBeTruthy();
  });

  it("offers Adjust quantity while the booking is out", () => {
    renderRow({ bookingStatus: "ONGOING", fulfilledQuantity: 8 });

    expect(
      screen.getByRole("button", { name: /adjust quantity/i })
    ).toBeTruthy();
  });

  it("offers Adjust quantity on an overdue booking", () => {
    renderRow({ bookingStatus: "OVERDUE", fulfilledQuantity: 8 });

    expect(
      screen.getByRole("button", { name: /adjust quantity/i })
    ).toBeTruthy();
  });

  it("drops every action once the booking is complete", () => {
    renderRow({ bookingStatus: "COMPLETE" });

    expect(
      screen.queryByRole("button", { name: /adjust quantity/i })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /scan to assign/i })).toBeNull();
  });

  it("offers Remove only while nothing is assigned to the reservation", () => {
    renderRow({ bookingStatus: "ONGOING", fulfilledQuantity: 0 });
    expect(screen.getByRole("button", { name: /^remove$/i })).toBeTruthy();

    screen.getByRole("button", { name: /adjust quantity/i });
  });

  it("hides Remove once units are on the booking, leaving the adjust route", () => {
    // Deleting the row would cut the assigned assets loose from the record of
    // how they landed on the booking; reducing the quantity is the way out.
    renderRow({ bookingStatus: "ONGOING", fulfilledQuantity: 3 });

    expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /adjust quantity/i })
    ).toBeTruthy();
  });
});
