/**
 * Tests for {@link CheckoutDropdown}: which check-out entry points a booking
 * header offers, that the explicit check-out requirement removes both
 * quick options ("Check out" and "Check out remaining") in favour of the
 * scanner, and that each quick option asks once before it submits.
 *
 * @see {@link file://./checkout-dropdown.tsx}
 */
import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CheckoutDropdown from "./checkout-dropdown";

/** Whether the mocked menu renders open; reset to closed before each test. */
let menuOpen = false;

// why: the hook reads the URL through the app's search-param helpers, which
// need a data router's loader data. Each test sets the starting open state,
// and the menu applies every close Radix asks for, as the real hook does on a
// phone after a QR auto-open, so a dialog inside the menu has to survive it.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => {
    const [open, setOpen] = useState(menuOpen);
    return {
      ref: { current: null },
      defaultApplied: true,
      open,
      defaultOpen: menuOpen,
      setOpen,
      onOpenChange: setOpen,
    };
  },
}));

// why: `useDisabled` reads `useNavigation`, which needs a data router; the
// MemoryRouter here only serves the scan link.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

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
  beforeEach(() => {
    menuOpen = false;
  });

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

  it("offers nothing at all when explicit check-out is required and there is nothing to scan", () => {
    // A reserved booking whose Booked bucket reads empty would otherwise get
    // the lone quick "Check out" button, which the server would refuse; a
    // scanner with nothing to scan is no better, so the control disappears.
    const { container } = renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: false,
      requireExplicitCheckout: true,
    });

    expect(quickCheckoutSubmits(container)).toHaveLength(0);
    expect(
      screen.queryByRole("link", { name: /scan to check out/i })
    ).not.toBeInTheDocument();
  });

  it("asks before the quick check-out on a reserved booking that is not early", () => {
    const { container } = renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: false,
    });

    expect(
      screen.queryByRole("link", { name: /scan to check out/i })
    ).not.toBeInTheDocument();
    // The trigger opens the dialog; only the dialog's button submits.
    expect(quickCheckoutSubmits(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));

    expect(
      screen.getByRole("alertdialog", { name: "Check out booking" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This checks out every asset of/)
    ).toBeInTheDocument();
    const submits = quickCheckoutSubmits(document.body);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAttribute("value", "checkOut");
    expect(submits[0]).toHaveTextContent("Check out");
  });

  it("asks before Check out remaining in the menu, with its own wording", () => {
    menuOpen = true;
    renderDropdown({
      canFullCheckOut: false,
      canCheckOutRemaining: true,
      canScanCheckOut: true,
    });

    expect(quickCheckoutSubmits(document.body)).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: /check out remaining/i })
    );

    expect(
      screen.getByRole("alertdialog", { name: "Check out booking" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This checks out the remaining assets of/)
    ).toBeInTheDocument();
    const submits = quickCheckoutSubmits(document.body);
    expect(submits).toHaveLength(1);
    expect(submits[0]).toHaveAttribute("value", "checkOutRemaining");
  });
});
