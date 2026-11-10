/**
 * Render tests for `NextReservationBadge`: when it shows, when it links to
 * the next booking, and how it words a reservation that already started.
 *
 * @see {@link file://./next-reservation-badge.tsx}
 */
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextReservations } from "~/modules/booking/next-reservations.server";
import { NextReservationBadge } from "./next-reservation-badge";

const mockUseLoaderData = vi.fn();

// why: the badge reads the booking page's loader data, and there is no router
// around a component rendered on its own.
vi.mock("react-router", async () => ({
  ...((await vi.importActual("react-router")) as Record<string, unknown>),
  useLoaderData: () => mockUseLoaderData(),
}));

// why: the shared Button needs router context to render a link; a plain
// anchor keeps the destination assertable.
vi.mock("../shared/button", () => ({
  Button: ({
    children,
    to,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    "aria-label"?: string;
  }) => (
    <a href={to} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));

// why: user date preferences come from the root loader; formatting itself is
// covered by @shelf/datetime, so a fixed ISO rendering keeps the copy exact.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    formatDateTime: (value: string) => new Date(value).toISOString(),
  }),
}));

const NOW = new Date("2026-11-03T12:00:00.000Z");
const LATER = "2026-11-05T08:00:00.000Z";
const EARLIER = "2026-11-02T08:00:00.000Z";

function loaderWith(nextReservations: NextReservations | undefined) {
  mockUseLoaderData.mockReturnValue({ nextReservations });
}

function reservations(
  next: NextReservations["byAssetId"][string]
): NextReservations {
  return {
    horizon: null,
    byAssetId: { "cam-1": next },
    byKitId: { "kit-1": next },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("NextReservationBadge", () => {
  it("renders nothing on a page whose loader carries no next reservations", () => {
    loaderWith(undefined);
    const { container } = render(
      <NextReservationBadge kind="asset" id="cam-1" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an item no booking needs next", () => {
    loaderWith(
      reservations({ bookingId: "b-2", bookingName: "Shoot", from: LATER })
    );
    const { container } = render(
      <NextReservationBadge kind="asset" id="cam-2" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("links to the next booking when the reader may see it", () => {
    loaderWith(
      reservations({ bookingId: "b-2", bookingName: "Shoot", from: LATER })
    );
    render(<NextReservationBadge kind="kit" id="kit-1" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/bookings/b-2");
    expect(link).toHaveAccessibleName(
      `Needed from ${LATER} by Shoot, open that booking`
    );
    expect(screen.getByText(`Needed ${LATER}`)).toBeInTheDocument();
  });

  it("is not a link when the reader may not see that booking", () => {
    loaderWith(
      reservations({
        bookingId: null,
        bookingName: "another booking",
        from: LATER,
      })
    );
    render(<NextReservationBadge kind="asset" id="cam-1" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(`Needed ${LATER}`)).toBeInTheDocument();
  });

  it("says since when for a reservation that already started", () => {
    loaderWith(
      reservations({ bookingId: "b-2", bookingName: "Shoot", from: EARLIER })
    );
    render(<NextReservationBadge kind="asset" id="cam-1" />);

    expect(screen.getByText(`Needed since ${EARLIER}`)).toBeInTheDocument();
  });
});
