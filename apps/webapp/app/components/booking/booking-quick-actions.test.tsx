/**
 * Which buttons a bookings-list row offers, by booking status and viewer.
 *
 * Pins the table in `booking-quick-actions.tsx`: Check out while RESERVED,
 * Check out remaining plus Check in while underway with items still booked,
 * Check in alone otherwise, nothing for a closed or draft booking. Also pins
 * the gates around it: the viewer's grant, the workspace's explicit scan
 * requirement per direction, ownership for a member held to their own
 * bookings, and the unassigned-units disable on a RESERVED booking.
 *
 * The dialogs the buttons open are the real `CheckoutDialog` /
 * `CheckinDialog`; only their trigger buttons are asserted on here. The form
 * each row posts is asserted on too: its action, the `origin` the server reads
 * to refuse a from-location case, and the JSON answer "Check out remaining"
 * asks for.
 *
 * @see {@link file://./booking-quick-actions.tsx}
 */
import type { ComponentProps, ReactNode } from "react";
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import type { ExplicitScanSettings } from "~/utils/permissions/role-access";
import {
  ASSIGN_UNITS_FIRST_REASON,
  BookingQuickActions,
  resolveCheckInOutActions,
} from "./booking-quick-actions";

/** The roles the viewer holds; both role hooks below read it. */
let mockRoles: OrganizationRoles[] = [OrganizationRoles.ADMIN];

/** The signed-in user, who created and holds the fixture booking. */
const ME = "user-me";

/** The workspace's explicit scan switches, all off unless a test flips one. */
const NO_EXPLICIT_SCAN: ExplicitScanSettings = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: false,
  requireExplicitCheckinForAdmin: false,
  requireExplicitCheckinForSelfService: false,
};
let mockBookingSettings: ExplicitScanSettings = NO_EXPLICIT_SCAN;

// why: the roles come off the `_layout` loader in real code, which is not
// mounted in a render test; drive them per test instead.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => mockRoles,
}));

// why: same loader for the resolved access; derive it from the same roles so
// the grant and the explicit-mode policy cannot disagree.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => accessFor(mockRoles),
}));

// why: the explicit scan switches also live on the `_layout` loader.
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => mockBookingSettings,
}));

// why: the signed-in user comes off the `_layout` loader too; the ownership
// gate compares the booking's creator and custodian with it.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: ME }),
}));

// why: `useFetcher` needs a data router; a plain form keeps the posted fields
// and attributes readable without one, which is what this test asserts on.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      Form: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <form {...props}>{children}</form>,
    }),
  };
});

// why: the dialogs read navigation state to disable their buttons; nothing in
// flight here.
vi.mock("~/hooks/use-disabled", () => ({ useDisabled: () => false }));

// why: the check-out dialog proposes an expired reservation's new end date in
// the user's resolved timezone, read from the root loader data this test does
// not mount. The dates are not under test.
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

type RowBooking = ComponentProps<typeof BookingQuickActions>["booking"];

/** A RESERVED booking with nothing unusual about it. */
function buildBooking(overrides: Partial<RowBooking> = {}): RowBooking {
  return {
    id: "booking-1",
    name: "Camera kit booking",
    status: BookingStatus.RESERVED,
    from: new Date("2026-08-01T09:00:00Z"),
    to: new Date("2026-08-05T17:00:00Z"),
    creatorId: ME,
    custodianUserId: ME,
    modelRequests: [],
    hasItemsToCheckOut: true,
    ...overrides,
  };
}

function renderRow(
  overrides: Partial<RowBooking> = {},
  {
    roles = [OrganizationRoles.ADMIN],
    settings = NO_EXPLICIT_SCAN,
  }: { roles?: OrganizationRoles[]; settings?: ExplicitScanSettings } = {}
) {
  mockRoles = roles;
  mockBookingSettings = settings;
  return render(<BookingQuickActions booking={buildBooking(overrides)} />);
}

/**
 * Each action button's accessible name, in order. The buttons are icon-only,
 * so the name is the label a screen reader announces and the tooltip shows.
 */
function buttonLabels(): string[] {
  return screen
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

describe("resolveCheckInOutActions: which buttons a status gets", () => {
  const CAN_BOTH = { canCheckOut: true, canCheckIn: true };

  it("offers Check out alone while RESERVED", () => {
    expect(
      resolveCheckInOutActions({
        booking: { status: BookingStatus.RESERVED, hasItemsToCheckOut: true },
        ...CAN_BOTH,
      })
    ).toEqual({ checkOut: true, checkOutRemaining: false, checkIn: false });
  });

  it.each([BookingStatus.ONGOING, BookingStatus.OVERDUE])(
    "offers Check out remaining and Check in while %s with items still booked",
    (status) => {
      expect(
        resolveCheckInOutActions({
          booking: { status, hasItemsToCheckOut: true },
          ...CAN_BOTH,
        })
      ).toEqual({ checkOut: false, checkOutRemaining: true, checkIn: true });
    }
  );

  it.each([BookingStatus.ONGOING, BookingStatus.OVERDUE])(
    "offers Check in alone while %s with everything already out",
    (status) => {
      expect(
        resolveCheckInOutActions({
          booking: { status, hasItemsToCheckOut: false },
          ...CAN_BOTH,
        })
      ).toEqual({ checkOut: false, checkOutRemaining: false, checkIn: true });
    }
  );

  it("reads a loader that did not resolve the flag as nothing left to check out", () => {
    expect(
      resolveCheckInOutActions({
        booking: { status: BookingStatus.ONGOING },
        ...CAN_BOTH,
      }).checkOutRemaining
    ).toBe(false);
  });

  it.each([
    BookingStatus.DRAFT,
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("offers nothing for a %s booking", (status) => {
    expect(
      resolveCheckInOutActions({
        booking: { status, hasItemsToCheckOut: true },
        ...CAN_BOTH,
      })
    ).toEqual({ checkOut: false, checkOutRemaining: false, checkIn: false });
  });

  it("drops the check-out buttons when the viewer may not check out", () => {
    expect(
      resolveCheckInOutActions({
        booking: { status: BookingStatus.ONGOING, hasItemsToCheckOut: true },
        canCheckOut: false,
        canCheckIn: true,
      })
    ).toEqual({ checkOut: false, checkOutRemaining: false, checkIn: true });
  });

  it("drops Check in when the viewer may not check in", () => {
    expect(
      resolveCheckInOutActions({
        booking: { status: BookingStatus.OVERDUE, hasItemsToCheckOut: false },
        canCheckOut: true,
        canCheckIn: false,
      })
    ).toEqual({ checkOut: false, checkOutRemaining: false, checkIn: false });
  });
});

describe("BookingQuickActions: what the row renders", () => {
  it("renders Check out for a RESERVED booking, posting to the booking's overview", () => {
    renderRow();

    expect(buttonLabels()).toEqual(["Check out"]);
    const form = document.getElementById(
      "booking-row-check-in-out-booking-1"
    ) as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/bookings/booking-1/overview");
    expect(form).toHaveAttribute("method", "post");
    // The server refuses a list check-out that needs a from-location answer.
    expect(form.elements.namedItem("origin")).toHaveValue("bookings-list");
    // "Check out remaining" answers with JSON rather than redirecting away.
    expect(form.elements.namedItem("returnJson")).toHaveValue("true");
  });

  it("renders Check out remaining and Check in for an ONGOING booking with items still booked", () => {
    renderRow({ status: BookingStatus.ONGOING, hasItemsToCheckOut: true });

    expect(buttonLabels()).toEqual(["Check out remaining", "Check in"]);
    // Icon-only, like the assets index's actions: no visible text in the cell.
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent?.trim()).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });

  it("renders Check in alone for an OVERDUE booking with everything out", () => {
    renderRow({ status: BookingStatus.OVERDUE, hasItemsToCheckOut: false });

    expect(buttonLabels()).toEqual(["Check in"]);
  });

  it.each([
    BookingStatus.DRAFT,
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("renders nothing for a %s booking", (status) => {
    const { container } = renderRow({ status });

    expect(container).toBeEmptyDOMElement();
  });

  it("disables Check out while reserved model units are unassigned, with the reason", () => {
    renderRow({
      modelRequests: [{ quantity: 2, fulfilledQuantity: 1, fulfilledAt: null }],
    });

    const button = screen.getByRole("button", { name: /check out/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(ASSIGN_UNITS_FIRST_REASON)).toBeInTheDocument();
  });

  it("keeps Check out enabled once every reserved unit is assigned", () => {
    renderRow({
      modelRequests: [
        {
          quantity: 2,
          fulfilledQuantity: 2,
          fulfilledAt: new Date("2026-08-01T08:00:00Z"),
        },
      ],
    });

    expect(screen.getByRole("button", { name: /check out/i })).toBeEnabled();
  });

  it("asks how to check out an expired reservation instead of posting a bare check-out", () => {
    // RESERVED with its end already passed: the server refuses a check-out
    // that does not say how to handle the passed dates, so the row's dialog
    // has to ask.
    renderRow({
      from: new Date("2020-01-01T09:00:00Z"),
      to: new Date("2020-01-02T17:00:00Z"),
    });

    fireEvent.click(screen.getByRole("button", { name: /check out/i }));

    expect(
      screen.getByText("Reservation dates have passed")
    ).toBeInTheDocument();
  });

  it("hides both check-out buttons when the workspace requires explicit check-out for the viewer", () => {
    renderRow(
      { status: BookingStatus.ONGOING, hasItemsToCheckOut: true },
      {
        settings: {
          ...NO_EXPLICIT_SCAN,
          requireExplicitCheckoutForAdmin: true,
        },
      }
    );

    expect(buttonLabels()).toEqual(["Check in"]);
  });

  it("hides Check in when the workspace requires explicit check-in for the viewer", () => {
    renderRow(
      { status: BookingStatus.ONGOING, hasItemsToCheckOut: true },
      {
        settings: { ...NO_EXPLICIT_SCAN, requireExplicitCheckinForAdmin: true },
      }
    );

    expect(buttonLabels()).toEqual(["Check out remaining"]);
  });

  it("reads the self-service switches for a SELF_SERVICE viewer, not the admin ones", () => {
    renderRow(
      { status: BookingStatus.RESERVED },
      {
        roles: [OrganizationRoles.SELF_SERVICE],
        settings: {
          ...NO_EXPLICIT_SCAN,
          requireExplicitCheckoutForSelfService: true,
        },
      }
    );

    expect(buttonLabels()).toEqual([]);
  });

  it("renders nothing for a SELF_SERVICE viewer on a booking they neither created nor hold", () => {
    const { container } = renderRow(
      {
        status: BookingStatus.ONGOING,
        creatorId: "user-admin",
        custodianUserId: "user-other",
      },
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the buttons for a SELF_SERVICE viewer on a booking they hold", () => {
    renderRow(
      {
        status: BookingStatus.ONGOING,
        hasItemsToCheckOut: false,
        creatorId: "user-admin",
        custodianUserId: ME,
      },
      { roles: [OrganizationRoles.SELF_SERVICE] }
    );

    expect(buttonLabels()).toEqual(["Check in"]);
  });

  it("renders the buttons for an ADMIN on anyone's booking", () => {
    renderRow({
      status: BookingStatus.RESERVED,
      creatorId: "user-other",
      custodianUserId: "user-another",
    });

    expect(buttonLabels()).toEqual(["Check out"]);
  });

  it("renders nothing for a BASE viewer, who holds neither grant", () => {
    const { container } = renderRow(
      { status: BookingStatus.ONGOING, hasItemsToCheckOut: true },
      { roles: [OrganizationRoles.BASE] }
    );

    expect(container).toBeEmptyDOMElement();
  });
});
