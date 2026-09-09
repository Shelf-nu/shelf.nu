/**
 * Render tests for `AvailabilityLabel`'s "Reserved by model" badge: when it
 * shows, when it stays hidden, and which reasons outrank it.
 *
 * @see {@link file://./availability-label.tsx}
 */
import type { ReactNode } from "react";
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { AvailabilityLabel } from "./availability-label";

const mockUseLoaderData = vi.fn();

// why: the label reads the current booking from route loader data, and there
// is no router around a component rendered on its own.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useLoaderData: () => mockUseLoaderData(),
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// why: the "Already booked" tooltip links to the conflicting booking through
// the shared Button, which needs router context this test does not mount.
vi.mock("../shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <a href="/test">{children}</a>
  ),
}));

/** A bookable, unheld, kit-free INDIVIDUAL unit. Overrides shape each case. */
function unit(overrides: Partial<AssetWithBooking> = {}): AssetWithBooking {
  return {
    id: "asset-1",
    title: "Suturing Practice Pad",
    type: AssetType.INDIVIDUAL,
    status: AssetStatus.AVAILABLE,
    availableToBook: true,
    custody: null,
    assetKits: [],
    bookingAssets: [],
    ...overrides,
  } as unknown as AssetWithBooking;
}

describe("AvailabilityLabel — reserved by model", () => {
  beforeEach(() => {
    mockUseLoaderData.mockReturnValue({
      booking: { id: "booking-1", status: BookingStatus.DRAFT },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the badge when the unit's model is reserved elsewhere", () => {
    render(
      <AvailabilityLabel
        asset={unit({ modelReservedElsewhere: true })}
        isCheckedOut={false}
      />
    );

    expect(screen.getByText("Reserved by model")).toBeInTheDocument();
  });

  it("shows nothing for an available unit without the flag", () => {
    const { container } = render(
      <AvailabilityLabel asset={unit()} isCheckedOut={false} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("lets an administrator's unbookable flag outrank it", () => {
    render(
      <AvailabilityLabel
        asset={unit({ availableToBook: false, modelReservedElsewhere: true })}
        isCheckedOut={false}
      />
    );

    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Reserved by model")).not.toBeInTheDocument();
  });

  it("lets a concrete overlapping booking outrank it", () => {
    render(
      <AvailabilityLabel
        asset={unit({
          modelReservedElsewhere: true,
          bookingAssets: [
            {
              booking: {
                id: "other-booking",
                name: "Other booking",
                status: BookingStatus.RESERVED,
              },
            },
          ] as unknown as AssetWithBooking["bookingAssets"],
        })}
        isCheckedOut={false}
      />
    );

    expect(screen.getByText("Already booked")).toBeInTheDocument();
    expect(screen.queryByText("Reserved by model")).not.toBeInTheDocument();
  });

  it("lets a unit that is checked out outrank it", () => {
    render(
      <AvailabilityLabel
        asset={unit({
          status: AssetStatus.CHECKED_OUT,
          modelReservedElsewhere: true,
        })}
        isCheckedOut
      />
    );

    // The unit-level reason describes this unit; the pool reason does not.
    expect(screen.getByText("Checked out")).toBeInTheDocument();
    expect(screen.queryByText("Reserved by model")).not.toBeInTheDocument();
  });
});
