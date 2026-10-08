/**
 * The booking strip at the top of the check-out and check-in scan drawers.
 *
 * Both drawers render this one component, so what it shows is what an
 * operator sees on either page: which booking they are scanning against, its
 * status, and its period.
 *
 * @see {@link file://./scan-booking-header.tsx}
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ScanBookingHeader } from "./scan-booking-header";

// why: DateS reads client hints from Remix context unavailable in the test;
// a plain node carrying the raw value is enough to tell the two dates apart.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => <span>{date}</span>,
}));

// why: BookingStatusBadge reads user data and roles from Remix context; the
// header only has to pass the status through.
vi.mock("~/components/booking/booking-status-badge", () => ({
  BookingStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

const booking = {
  id: "booking-1",
  name: "Studio shoot",
  status: "RESERVED" as const,
  custodianUserId: null,
  from: "2026-10-07T13:03:00.000Z",
  to: "2026-10-07T17:08:00.000Z",
};

describe("ScanBookingHeader", () => {
  it("names the booking, links to it and shows its status", () => {
    render(<ScanBookingHeader booking={booking} />, { wrapper: MemoryRouter });

    expect(screen.getByRole("link", { name: "Studio shoot" })).toHaveAttribute(
      "href",
      "/bookings/booking-1"
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("RESERVED");
  });

  it("shows the period start to end, labelled for screen readers", () => {
    const { container } = render(<ScanBookingHeader booking={booking} />, {
      wrapper: MemoryRouter,
    });

    // Visually "start → end"; the hidden words keep it readable aloud.
    expect(container).toHaveTextContent(`From${booking.from}→to${booking.to}`);
  });
});
