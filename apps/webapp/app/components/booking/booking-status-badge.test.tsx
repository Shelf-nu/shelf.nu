/**
 * Tests for {@link BookingStatusBadge}: a RESERVED booking whose end has
 * passed reads "Expired", including on a page left open across that end.
 *
 * @see {@link file://./booking-status-badge.tsx}
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BookingStatusBadge } from "./booking-status-badge";

// why: both hooks read the root loader data, which this component test does
// not mount; only the reservation-request tooltip depends on them.
vi.mock("~/hooks/use-reservation-is-request", () => ({
  useReservationIsRequest: () => false,
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

describe("BookingStatusBadge", () => {
  const NOW = new Date("2026-10-20T12:00:00Z").getTime();

  beforeEach(() => {
    // why: the Expired label reads the clock, so pin and advance it
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads Expired for a reservation whose end has passed", () => {
    render(
      <BookingStatusBadge
        status="RESERVED"
        custodianUserId={undefined}
        to={new Date(NOW - 60_000)}
      />
    );
    expect(screen.getByText("EXPIRED")).toBeInTheDocument();
  });

  it("turns to Expired once the end passes on a page left open", () => {
    render(
      <BookingStatusBadge
        status="RESERVED"
        custodianUserId={undefined}
        to={new Date(NOW + 60_000)}
      />
    );
    expect(screen.getByText("RESERVED")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });

    expect(screen.getByText("EXPIRED")).toBeInTheDocument();
  });

  it("keeps the stored status when no end date is passed", () => {
    render(
      <BookingStatusBadge status="RESERVED" custodianUserId={undefined} />
    );
    expect(screen.getByText("RESERVED")).toBeInTheDocument();
  });
});
