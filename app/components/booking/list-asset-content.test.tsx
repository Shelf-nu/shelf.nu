import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import ListAssetContent from "./list-asset-content";

const {
  assetStatusBadgeMock,
  getBookingContextAssetStatusMock,
  isAssetPartiallyCheckedInMock,
} = vi.hoisted(() => ({
  assetStatusBadgeMock: vi.fn(),
  getBookingContextAssetStatusMock: vi.fn(() => "AVAILABLE"),
  isAssetPartiallyCheckedInMock: vi.fn(() => false),
}));

vi.mock("../assets/asset-status-badge", () => ({
  AssetStatusBadge: (props: unknown) => assetStatusBadgeMock(props),
}));

vi.mock("../assets/asset-image", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));

vi.mock("../assets/category-badge", () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));

vi.mock("../shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#">{children}</a>
  ),
}));

vi.mock("../shared/date", () => ({
  DateS: ({ date }: { date: string }) => <span>{date}</span>,
}));

vi.mock("../shared/user-badge", () => ({
  UserBadge: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("../list/bulk-actions/bulk-list-item-checkbox", () => ({
  default: () => <td data-testid="bulk-checkbox" />,
}));

vi.mock("./asset-row-actions-dropdown", () => ({
  AssetRowActionsDropdown: () => <div data-testid="asset-actions" />,
}));

vi.mock("./availability-label", () => ({
  AvailabilityLabel: () => <div data-testid="availability-label" />,
}));

const mockUseLoaderData = vi.fn();

vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
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

const mockUseBookingStatusHelpers = vi.fn();

vi.mock("~/hooks/use-booking-status", () => ({
  useBookingStatusHelpers: (status: string) =>
    mockUseBookingStatusHelpers(status),
}));

vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({
    isBase: false,
    isSelfService: false,
    isBaseOrSelfService: false,
  }),
}));

vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

vi.mock("~/utils/booking-assets", () => ({
  getBookingContextAssetStatus: (
    ...args: Parameters<typeof getBookingContextAssetStatusMock>
  ) => getBookingContextAssetStatusMock(...args),
  isAssetPartiallyCheckedIn: (
    ...args: Parameters<typeof isAssetPartiallyCheckedInMock>
  ) => isAssetPartiallyCheckedInMock(...args),
}));

describe("ListAssetContent", () => {
  const basePartialDetails = {} as PartialCheckinDetailsType;

  const baseAsset = {
    id: "asset-1",
    title: "Camera",
    status: "AVAILABLE",
    bookings: [],
    availableToBook: true,
    category: { id: "category-1", name: "Cameras" },
  } as unknown as AssetWithBooking;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseBookingStatusHelpers.mockImplementation((status: string) => ({
      isCompleted: status === "COMPLETE",
      isArchived: status === "ARCHIVED",
      isReserved: status === "RESERVED",
      isDraft: status === "DRAFT",
      isOngoing: status === "ONGOING",
      isOverdue: status === "OVERDUE",
      isCancelled: status === "CANCELLED",
      isInProgress: status === "ONGOING" || status === "OVERDUE",
      isFinished: status === "COMPLETE" || status === "ARCHIVED",
    }));

    assetStatusBadgeMock.mockImplementation(() => (
      <div data-testid="asset-status-badge">AssetStatusBadge</div>
    ));

    getBookingContextAssetStatusMock.mockReturnValue("AVAILABLE");
    isAssetPartiallyCheckedInMock.mockReturnValue(false);
  });

  it("shows a returned badge with a check icon when the booking is complete", () => {
    mockUseLoaderData.mockReturnValue({
      booking: {
        id: "booking-1",
        status: "COMPLETE",
        assets: [],
        custodianUser: null,
      },
    });

    render(
      <table>
        <tbody>
          <tr>
            <ListAssetContent
              item={baseAsset}
              partialCheckinDetails={basePartialDetails}
              shouldShowCheckinColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    const returnedBadge = screen.getByText("Returned");
    expect(returnedBadge).toBeInTheDocument();

    const badgeWrapper = returnedBadge.closest("span");
    expect(badgeWrapper).not.toBeNull();

    const icon = badgeWrapper?.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("text-gray-500");

    expect(assetStatusBadgeMock).not.toHaveBeenCalled();
  });

  it("falls back to the asset status badge when the booking is not complete", () => {
    mockUseLoaderData.mockReturnValue({
      booking: {
        id: "booking-2",
        status: "ONGOING",
        assets: [],
        custodianUser: null,
      },
    });

    render(
      <table>
        <tbody>
          <tr>
            <ListAssetContent
              item={baseAsset}
              partialCheckinDetails={basePartialDetails}
              shouldShowCheckinColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(assetStatusBadgeMock).toHaveBeenCalled();
    expect(screen.getByTestId("asset-status-badge")).toBeInTheDocument();
  });
});
