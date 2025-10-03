import type { Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvailabilityLabel } from "~/components/booking/availability-label";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { hasAssetBookingConflicts } from "~/modules/booking/helpers";
import { useLoaderData } from "@remix-run/react";

vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual<typeof import("@remix-run/react")>(
    "@remix-run/react"
  );

  return {
    ...actual,
    useLoaderData: vi.fn(),
    Link: ({ children, to, ...props }: any) => (
      <a href={typeof to === "string" ? to : ""} {...props}>
        {children}
      </a>
    ),
  };
});

vi.mock("~/modules/booking/helpers", () => ({
  hasAssetBookingConflicts: vi.fn(),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const hasAssetBookingConflictsMock = vi.mocked(hasAssetBookingConflicts);

function createAsset(overrides: Partial<AssetWithBooking> = {}): AssetWithBooking {
  return {
    id: "asset-1",
    name: "Camera",
    description: null,
    imageId: null,
    kitId: null,
    custody: null,
    categoryId: "category-1",
    organizationId: "org-1",
    locationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    barcode: null,
    availableToBook: true,
    requireLabelOnCheckout: false,
    bookings: [],
    tags: [],
    qrCodes: [],
    qrScanned: "",
    ...overrides,
  } as AssetWithBooking;
}

describe("AvailabilityLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      booking: {
        id: "current-booking",
        name: "Current Booking",
        status: BookingStatus.RESERVED,
      } as Booking,
    });
    hasAssetBookingConflictsMock.mockReturnValue(true);
  });

  it("shows the newest conflicting booking in the tooltip", async () => {
    const asset = createAsset({
      bookings: [
        {
          id: "old-booking",
          name: "Old Booking",
          status: BookingStatus.RESERVED,
          from: new Date("2024-01-01T10:00:00Z"),
          to: new Date("2024-01-02T10:00:00Z"),
        },
        {
          id: "new-booking",
          name: "New Booking",
          status: BookingStatus.ONGOING,
          from: new Date("2024-02-01T10:00:00Z"),
          to: new Date("2024-02-02T10:00:00Z"),
        },
      ],
    });

    render(
      <AvailabilityLabel asset={asset} isCheckedOut={false} isAlreadyAdded={false} />
    );

    const user = userEvent.setup();
    await user.hover(await screen.findByText("Already booked"));

    const links = await screen.findAllByRole("link", {
      name: "New Booking",
    });
    expect(
      links.some(
        (link) => link.getAttribute("href") === "/bookings/new-booking"
      )
    ).toBe(true);
  });

  it("skips the current booking when selecting the conflicting booking", async () => {
    const asset = createAsset({
      bookings: [
        {
          id: "current-booking",
          name: "Current Booking",
          status: BookingStatus.ONGOING,
          from: new Date("2024-03-01T10:00:00Z"),
          to: new Date("2024-03-02T10:00:00Z"),
        },
        {
          id: "other-booking",
          name: "Other Booking",
          status: BookingStatus.OVERDUE,
          from: new Date("2024-02-01T10:00:00Z"),
          to: new Date("2024-02-02T10:00:00Z"),
        },
      ],
    });

    render(
      <AvailabilityLabel asset={asset} isCheckedOut={false} isAlreadyAdded={false} />
    );

    const user = userEvent.setup();
    await user.hover(await screen.findByText("Already booked"));

    const links = await screen.findAllByRole("link", {
      name: "Other Booking",
    });
    expect(
      links.some(
        (link) => link.getAttribute("href") === "/bookings/other-booking"
      )
    ).toBe(true);
  });
});
