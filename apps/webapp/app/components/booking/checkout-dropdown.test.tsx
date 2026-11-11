/**
 * Tests for {@link CheckoutDropdown}: which check-out entry points a booking
 * header offers, that the explicit check-out requirement removes both
 * quick options ("Check out" and "Check out remaining") in favour of the
 * scanner, that each quick option asks once before it submits, and that the
 * menu's dialog keeps its "From location" picker usable with a mouse.
 *
 * @see {@link file://./checkout-dropdown.tsx}
 */
import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useNavigation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";

import CheckoutDropdown from "./checkout-dropdown";

/** Whether the mocked menu renders open; reset to closed before each test. */
let menuOpen = false;

// why: the hook reads the URL through the app's search-param helpers, which
// need a data router's loader data. Each test sets the starting open state,
// and the menu applies every close Radix asks for, as the real hook does on a
// phone after a QR auto-open, so a dialog inside the menu has to survive it.
// why: the dialog proposes an expired reservation's new end date in the
// user's resolved timezone, read from root loader data this test does not
// mount. No expired booking is rendered here.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    prefs: {
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: "UTC",
    },
    formatDate: (value: string | Date) => String(value),
    formatTime: (value: string | Date) => String(value),
    formatDateTime: (value: string | Date) => String(value),
  }),
}));

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

/** A pool kept at two locations, so the check-out asks where units leave from. */
const sourceQuestion: CheckoutSourceQuestion = {
  sliceId: "slice-1",
  assetId: "asset-1",
  title: "Light bulbs",
  unitOfMeasure: "pcs",
  quantity: 3,
  placements: [
    {
      locationId: "loc-warehouse",
      name: "Warehouse",
      placed: 8,
      inCustody: 0,
      onBooking: 0,
      left: 8,
    },
    {
      locationId: "loc-studio",
      name: "Studio",
      placed: 5,
      inCustody: 0,
      onBooking: 0,
      left: 5,
    },
  ],
  unplaced: 0,
  defaultLocationId: "loc-warehouse",
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

  it.each(["Enter", " "])(
    "opens the check-out dialog from the menu row with the %j key",
    (key) => {
      menuOpen = true;
      renderDropdown({
        canFullCheckOut: true,
        canCheckOutRemaining: false,
        canScanCheckOut: true,
      });

      // Arrow-key focus lands on the menu item, not the button inside it.
      const row = screen.getAllByRole("menuitem")[0];
      row.focus();
      fireEvent.keyDown(row, { key });

      expect(
        screen.getByRole("alertdialog", { name: "Check out booking" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    }
  );

  it("does not open the check-out dialog from a disabled menu row", () => {
    menuOpen = true;
    renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: true,
      checkOutDisabled: { reason: "Some assets are in custody." },
    });

    const row = screen.getAllByRole("menuitem")[0];
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("announces a disabled Check out row and its reason on the row itself", () => {
    menuOpen = true;
    renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: true,
      checkOutDisabled: { reason: "Some assets are in custody." },
    });

    // Arrow-key focus lands on the row, so the row has to say it is disabled,
    // and read the reason once (from the button's hidden description).
    const row = screen.getAllByRole("menuitem")[0];
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row.textContent?.split("Some assets are in custody.").length).toBe(
      2
    );
  });

  it("marks the Scan to check out row disabled with the control", () => {
    menuOpen = true;
    renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: true,
      disabled: true,
    });

    expect(screen.getAllByRole("menuitem")[1]).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("does not open the check-out dialog while a submission is in flight", () => {
    vi.mocked(useNavigation).mockReturnValue({ state: "submitting" } as never);
    try {
      menuOpen = true;
      renderDropdown({
        canFullCheckOut: true,
        canCheckOutRemaining: false,
        canScanCheckOut: true,
      });

      const row = screen.getAllByRole("menuitem")[0];
      row.focus();
      fireEvent.keyDown(row, { key: "Enter" });

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    } finally {
      vi.mocked(useNavigation).mockReturnValue({ state: "idle" } as never);
    }
  });

  it("lets the operator pick a From location with the mouse", () => {
    // A menu item takes focus on every mouse move it sees, and React bubbles
    // a portaled dialog's events to its component parents. Focus leaving the
    // picker's list shuts it, so the dialog must not sit inside the menu.
    menuOpen = true;
    renderDropdown({
      canFullCheckOut: true,
      canCheckOutRemaining: false,
      canScanCheckOut: true,
      sourceQuestions: [sourceQuestion],
    });

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("button", {
        name: "Check out",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Light bulbs/ }));
    const studio = screen.getByRole("option", { name: "Studio · 5 pcs" });
    fireEvent.mouseEnter(studio);
    fireEvent.pointerMove(studio, { pointerType: "mouse" });

    expect(document.activeElement).toBe(studio);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.click(studio);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="sourceLocation.slice-1"]'
      )?.value
    ).toBe("loc-studio");
  });
});
