import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import { BADGE_COLORS } from "~/utils/badge-colors";
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

// why: isolating component from child component rendering to test returned badge logic
vi.mock("../assets/asset-status-badge", () => ({
  AssetStatusBadge: (props: unknown) => assetStatusBadgeMock(props),
}));

// why: preventing complex image rendering during component unit tests
vi.mock("../assets/asset-image", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));

// why: simplifying category badge rendering for focused unit testing
vi.mock("../assets/category-badge", () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));

// why: avoiding button component complexity during unit tests
vi.mock("../shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    // eslint-disable-next-line jsx-a11y/anchor-is-valid
    <a href="#">{children}</a>
  ),
}));

// why: simplifying date rendering for focused component testing
vi.mock("../shared/date", () => ({
  DateS: ({ date }: { date: string }) => <span>{date}</span>,
}));

// why: avoiding user badge rendering complexity during component tests
vi.mock("../shared/user-badge", () => ({
  UserBadge: ({ name }: { name: string }) => <span>{name}</span>,
}));

// why: isolating list item content from bulk selection checkbox logic
vi.mock("../list/bulk-actions/bulk-list-item-checkbox", () => ({
  default: () => <td data-testid="bulk-checkbox" />,
}));

// why: simplifying actions dropdown for focused status badge testing
vi.mock("./asset-row-actions-dropdown", () => ({
  AssetRowActionsDropdown: () => <div data-testid="asset-actions" />,
}));

// why: avoiding availability label rendering during returned badge testing
vi.mock("./availability-label", () => ({
  AvailabilityLabel: () => <div data-testid="availability-label" />,
}));

const mockUseLoaderData = vi.fn();

// why: controlling booking loader data to test different booking status scenarios
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

const mockUseBookingStatusHelpers = vi.fn();

// why: mocking booking status helpers to control test scenarios (complete vs ongoing)
vi.mock("~/hooks/use-booking-status", () => ({
  useBookingStatusHelpers: (status: string) =>
    mockUseBookingStatusHelpers(status),
}));

// why: providing test user role context without auth dependencies
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({
    isBase: false,
    isSelfService: false,
    isBaseOrSelfService: false,
  }),
}));

// why: providing test user data without session/auth lookups
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: controlling asset status logic to test returned badge vs status badge behavior
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
    expect(icon).toHaveStyle({ color: BADGE_COLORS.gray.text });

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
