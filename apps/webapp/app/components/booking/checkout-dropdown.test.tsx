/**
 * Tests for {@link CheckoutDropdown}: which check-out entry points a booking
 * header offers, and that the explicit check-out requirement removes both
 * one-click options ("Check out" and "Check out remaining") in favour of the
 * scanner.
 *
 * @see {@link file://./checkout-dropdown.tsx}
 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import CheckoutDropdown from "./checkout-dropdown";

// why: the hook reads the URL through the app's search-param helpers, which
// need a data router's loader data; these tests cover which options render,
// not how the menu opens, so a closed menu is enough.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    defaultApplied: true,
    open: false,
    defaultOpen: false,
    setOpen: vi.fn(),
  }),
}));

/** A booking that started an hour ago, so no early-check-out prompt applies. */
const booking = {
  id: "booking-1",
  name: "Field kit",
  from: new Date(Date.now() - 60 * 60 * 1000),
};

const SCAN_PAGE = "/bookings/booking-1/overview/checkout-assets";

type Props = ComponentProps<typeof CheckoutDropdown>;

/** Renders the control inside a router, since the scan option is a link. */
function renderDropdown(props: Omit<Props, "booking">) {
  return render(
    <MemoryRouter>
      <CheckoutDropdown booking={booking} {...props} />
    </MemoryRouter>
  );
}

/** The submit buttons that would post a one-click check-out intent. */
function quickCheckoutSubmits(container: HTMLElement) {
  return container.querySelectorAll(
    'button[name="intent"][value="checkOut"], button[name="intent"][value="checkOutRemaining"]'
  );
}

describe("CheckoutDropdown", () => {
  it("offers only the scanner on a reserved booking when explicit check-out is required", () => {
    const { container } = renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: true,
      requireExplicitCheckout: true,
    });

    expect(
      screen.getByRole("link", { name: /scan to check out/i })
    ).toHaveAttribute("href", SCAN_PAGE);
    expect(quickCheckoutSubmits(container)).toHaveLength(0);
    // No dropdown trigger either: the scanner is the whole control.
    expect(
      screen.queryByRole("button", { name: /check out/i })
    ).not.toBeInTheDocument();
  });

  it("offers only the scanner on an ongoing booking when explicit check-out is required", () => {
    const { container } = renderDropdown({
      canFullCheckOut: false,
      canCheckOutRemaining: true,
      canScanCheckOut: true,
      requireExplicitCheckout: true,
    });

    expect(
      screen.getByRole("link", { name: /scan to check out/i })
    ).toHaveAttribute("href", SCAN_PAGE);
    expect(quickCheckoutSubmits(container)).toHaveLength(0);
    expect(screen.queryByText(/check out remaining/i)).not.toBeInTheDocument();
  });

  it("never falls back to the one-click check-out when the scanner has nothing listed", () => {
    // A reserved booking whose Booked bucket reads empty would otherwise get
    // the lone quick "Check out" button.
    const { container } = renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: false,
      requireExplicitCheckout: true,
    });

    expect(quickCheckoutSubmits(container)).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: /scan to check out/i })
    ).toHaveAttribute("href", SCAN_PAGE);
  });

  it("keeps the one-click check-out when explicit check-out is not required", () => {
    const { container } = renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: false,
    });

    const submits = quickCheckoutSubmits(container);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAttribute("value", "checkOut");
    expect(
      screen.queryByRole("link", { name: /scan to check out/i })
    ).not.toBeInTheDocument();
  });
});
