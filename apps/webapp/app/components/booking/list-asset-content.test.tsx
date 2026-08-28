import type { ReactNode } from "react";
import { OrganizationRoles } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// why: simplifying tags column rendering to verify tag data flows from list item
vi.mock("../assets/assets-index/list-item-tags-column", () => ({
  ListItemTagsColumn: ({ tags }: { tags?: { name: string }[] }) => (
    <div data-testid="tags-column">
      {tags?.map((tag) => tag.name).join(",")}
    </div>
  ),
}));

// why: avoiding button component complexity during unit tests
vi.mock("../shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <a href="/test">{children}</a>
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

// why: exercising the REAL `AvailabilityLabel` + `InsufficientStockBadge`
// from this module so the QT-aware "Checked out" / "In custody" guards
// (which short-circuit for QUANTITY_TRACKED) and the red insufficient-stock
// badge can be observed by these tests. No mock — the originals are pure
// and only depend on `useLoaderData` (already mocked) + shared utils.

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

const mockUseUserRoleHelper = vi.fn();

// why: providing test user role context without auth dependencies, and letting
// a test choose the roles — the row's checkbox is gated on what those roles may
// actually do with a selection.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => mockUseUserRoleHelper(),
}));

// why: providing test user data without session/auth lookups
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: useCurrentOrganization calls useRouteLoaderData under the hood, which
// throws outside a router context. Mock returns a minimal org shape so the
// AssetCodeBadge resolver receives valid inputs in component tests.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({
    barcodesEnabled: false,
    qrIdDisplayPreference: "QR_ID",
  }),
}));

// why: controlling asset status logic to test returned badge vs status badge
// behavior. Only the two status resolvers are stubbed; the rest of the module
// (notably the pure per-slice `isBookingRowQtyFullyCheckedOut`) uses the REAL
// implementation via importActual so the per-slice checkout badge is exercised
// for real, not mocked away. (The `import type` of service.server in the real
// module is erased at runtime, so no server code is pulled in.)
vi.mock("~/utils/booking-assets", async () => {
  const actual = (await vi.importActual("~/utils/booking-assets")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    getBookingContextAssetStatus: (
      ...args: Parameters<typeof getBookingContextAssetStatusMock>
    ) => getBookingContextAssetStatusMock(...args),
    isAssetPartiallyCheckedIn: (
      ...args: Parameters<typeof isAssetPartiallyCheckedInMock>
    ) => isAssetPartiallyCheckedInMock(...args),
  };
});

describe("ListAssetContent", () => {
  const basePartialDetails = {} as PartialCheckinDetailsType;

  const baseAsset = {
    id: "asset-1",
    title: "Camera",
    status: "AVAILABLE",
    bookings: [],
    availableToBook: true,
    category: { id: "category-1", name: "Cameras" },
    tags: [{ id: "tag-1", name: "Fragile", color: "blue" }],
  } as unknown as AssetWithBooking;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no roles, matching what every test here assumed before the
    // checkbox became role-dependent. Tests that care set their own.
    mockUseUserRoleHelper.mockReturnValue({
      isBase: false,
      isSelfService: false,
      isBaseOrSelfService: false,
      roles: undefined,
    });

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
              partialCheckoutDetails={{}}
              shouldShowCheckoutColumns={false}
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

  it("does NOT show the returned badge for a never-checked-out asset on a complete booking", () => {
    // Progressive checkout: checkout records exist (for asset-2), but the asset
    // being rendered (asset-1) was never checked out, so it must NOT be marked
    // "Returned" even though the booking is COMPLETE.
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
              partialCheckoutDetails={{
                "asset-2": {
                  checkoutDate: "2026-06-01",
                  checkedOutBy: {
                    id: "user-1",
                    firstName: "Test",
                    lastName: "User",
                    displayName: null,
                    profilePicture: null,
                  },
                },
              }}
              shouldShowCheckoutColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByText("Returned")).not.toBeInTheDocument();
    expect(assetStatusBadgeMock).toHaveBeenCalled();
  });

  it("shows the returned badge for a checked-out asset on a complete booking with progressive checkout", () => {
    // asset-1 HAS a checkout record → it was actually checked out → Returned.
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
              partialCheckoutDetails={{
                "asset-1": {
                  checkoutDate: "2026-06-01",
                  checkedOutBy: {
                    id: "user-1",
                    firstName: "Test",
                    lastName: "User",
                    displayName: null,
                    profilePicture: null,
                  },
                },
              }}
              shouldShowCheckoutColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText("Returned")).toBeInTheDocument();
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
              partialCheckoutDetails={{}}
              shouldShowCheckoutColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(assetStatusBadgeMock).toHaveBeenCalled();
    expect(screen.getByTestId("asset-status-badge")).toBeInTheDocument();
  });

  it("renders asset tags in the tags column", () => {
    mockUseLoaderData.mockReturnValue({
      booking: {
        id: "booking-3",
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
              partialCheckoutDetails={{}}
              shouldShowCheckoutColumns={false}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByTestId("tags-column")).toHaveTextContent("Fragile");
  });

  // QT booking-row badge cleanup: QUANTITY_TRACKED rows must not surface the
  // global-status amber "Checked out" / "In custody" badges that
  // `AvailabilityLabel` shows for INDIVIDUAL assets — for QT the asset can be
  // checked out / in-custody elsewhere while still having free units to book.
  // The status badge + dedicated `InsufficientStockBadge` carry that signal
  // instead. These tests pin the QT-only short-circuits and the per-row
  // insufficient-stock branch, plus a regression guard that INDIVIDUAL
  // surfaces the amber "Checked out" badge unchanged.
  describe("QT availability badges", () => {
    /**
     * QT asset that is CHECKED_OUT globally (e.g. some other booking has its
     * units out). Includes `bookingAssets` so the `isCheckedOut` memo in
     * `ListAssetContent` can short-circuit cleanly, and `custody` so the
     * `hasCustody` branch in `AvailabilityLabel` is exercised in test (b).
     */
    const qtCheckedOutAsset = {
      ...baseAsset,
      id: "asset-qt-1",
      type: "QUANTITY_TRACKED",
      status: "CHECKED_OUT",
      bookingAssets: [
        // Conflict from a DIFFERENT booking — proves the QT short-circuit
        // fires regardless of the cross-org booking pressure.
        {
          booking: { id: "other-booking", status: "ONGOING" },
        },
      ],
      bookedQuantity: 1,
    } as unknown as AssetWithBooking;

    /** Same shape but with a custody row attached — used by test (b). */
    const qtCustodyAsset = {
      ...qtCheckedOutAsset,
      status: "AVAILABLE",
      custody: [{ id: "custody-1" }],
    } as unknown as AssetWithBooking;

    /**
     * INDIVIDUAL counterpart for the regression test (d) — same global
     * CHECKED_OUT signal but typed INDIVIDUAL so the QT short-circuit in
     * `AvailabilityLabel` must NOT fire.
     *
     * No `bookingAssets` entry for any OTHER booking — that would make
     * `hasAssetBookingConflicts` return true and steer the label into the
     * "Already booked" branch (a separate signal). Test (d) is specifically
     * pinning the "Checked out" branch: asset is globally CHECKED_OUT with
     * no overlapping reservation, which surfaces the amber "Checked out"
     * `AvailabilityBadge`.
     */
    const individualCheckedOutAsset = {
      ...baseAsset,
      id: "asset-individual-1",
      type: "INDIVIDUAL",
      status: "CHECKED_OUT",
      bookingAssets: [],
    } as unknown as AssetWithBooking;

    it("renders only the AVAILABLE status badge for a QT row whose asset is CHECKED_OUT elsewhere on a DRAFT booking", () => {
      // (a) — QT short-circuits the amber "Checked out" branch in
      // `AvailabilityLabel`, and there's no separate "Partial custody" badge.
      // The status badge resolves to AVAILABLE (no qty disposition/checkout
      // activity on this row).
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-draft",
          status: "DRAFT",
          bookingAssets: [{ assetId: qtCheckedOutAsset.id }],
          custodianUser: null,
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtCheckedOutAsset}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(assetStatusBadgeMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "AVAILABLE" })
      );
      // No amber "Checked out" availability badge for QT rows.
      expect(screen.queryByText("Checked out")).not.toBeInTheDocument();
      // No blue "Partial custody" badge exists for QT in this surface.
      expect(screen.queryByText(/partial custody/i)).not.toBeInTheDocument();
      // And no "Insufficient stock" since the loader didn't ship availability.
      expect(screen.queryByText(/insufficient stock/i)).not.toBeInTheDocument();
    });

    it("renders only the AVAILABLE status badge for a QT row with global custody on a RESERVED booking", () => {
      // (b) — QT short-circuits the "In custody" branch in
      // `AvailabilityLabel` even when a custody row exists on the asset.
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-reserved",
          status: "RESERVED",
          bookingAssets: [{ assetId: qtCustodyAsset.id }],
          custodianUser: null,
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtCustodyAsset}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(assetStatusBadgeMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "AVAILABLE" })
      );
      expect(screen.queryByText("In custody")).not.toBeInTheDocument();
      expect(screen.queryByText("Checked out")).not.toBeInTheDocument();
    });

    it("renders the red InsufficientStockBadge when bookedQuantity exceeds availableUnitsByAsset on an ONGOING booking", async () => {
      // (c) — QT row reserves 10 units; only 3 free across the workspace.
      // Renders the red-variant `InsufficientStockBadge`, with a hoverable
      // tooltip body that quotes both numbers verbatim.
      const qtRow = {
        ...qtCheckedOutAsset,
        status: "AVAILABLE",
        bookedQuantity: 10,
      } as unknown as AssetWithBooking;
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-ongoing",
          status: "ONGOING",
          bookingAssets: [{ assetId: qtRow.id }],
          custodianUser: null,
        },
        availableUnitsByAsset: { [qtRow.id]: { bookable: 3, physicalNow: 3 } },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtRow}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      const trigger = screen.getByText("Insufficient stock");
      expect(trigger).toBeInTheDocument();
      // Red variant — the `AvailabilityBadge` shell switches to red-50/red-200
      // /red-700 classes when `variant="error"` (set by `InsufficientStockBadge`).
      // Locking on `bg-red-50` is enough to differentiate from the amber default.
      expect(trigger).toHaveClass("bg-red-50");
      expect(trigger).toHaveClass("text-red-700");

      // Hover to surface the tooltip body and verify it mentions both 10/3.
      // Use pointer-event-based hover (Radix Tooltip listens via pointer events).
      await userEvent.hover(trigger);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toMatch(/10 units/);
      expect(tooltip.textContent).toMatch(/only 3/);
    });

    it("still renders the amber 'Checked out' AvailabilityBadge for an INDIVIDUAL row whose asset is checked out elsewhere", () => {
      // (d) — Regression guard: the QT short-circuits MUST NOT affect the
      // INDIVIDUAL path. An INDIVIDUAL asset with global CHECKED_OUT status
      // still surfaces the amber "Checked out" availability badge on a DRAFT
      // booking exactly as it did before this cleanup.
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-draft-individual",
          status: "DRAFT",
          bookingAssets: [{ assetId: individualCheckedOutAsset.id }],
          custodianUser: null,
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={individualCheckedOutAsset}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      const badge = screen.getByText("Checked out");
      expect(badge).toBeInTheDocument();
      // Amber default variant — `bg-warning-50` is the warning-amber background
      // applied by `AvailabilityBadge` when `variant` is omitted / "warning".
      expect(badge).toHaveClass("bg-warning-50");
    });

    it("does NOT render the InsufficientStockBadge when bookedQuantity is within availableUnits", () => {
      // (e) — QT row reserves 2 units; 5 free across the workspace. Headroom
      // exists, so the badge MUST NOT render. Strict-inequality guard in
      // `list-asset-content.tsx`: at-capacity (booked === available) is also
      // NOT a problem.
      const qtRow = {
        ...qtCheckedOutAsset,
        status: "AVAILABLE",
        bookedQuantity: 2,
      } as unknown as AssetWithBooking;
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-ongoing-ok",
          status: "ONGOING",
          bookingAssets: [{ assetId: qtRow.id }],
          custodianUser: null,
        },
        availableUnitsByAsset: { [qtRow.id]: { bookable: 5, physicalNow: 5 } },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtRow}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(screen.queryByText(/insufficient stock/i)).not.toBeInTheDocument();
    });

    it("renders the amber PendingReturnBadge on a not-started booking when rowQty fits bookable but exceeds physicalNow", async () => {
      // (b) — "Boards" real case: 10 total, 7 needed for this RESERVED
      // booking. The 7 currently out on another booking return before this
      // booking's window opens, so bookable=10 (no in-window conflict) but
      // physicalNow=3 (7 are literally off the shelf right now). Soft amber
      // warning, NOT the red blocker.
      const qtRow = {
        ...qtCheckedOutAsset,
        status: "AVAILABLE",
        bookedQuantity: 7,
      } as unknown as AssetWithBooking;
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-reserved",
          status: "RESERVED",
          bookingAssets: [{ assetId: qtRow.id }],
          custodianUser: null,
        },
        availableUnitsByAsset: {
          [qtRow.id]: { bookable: 10, physicalNow: 3 },
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtRow}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      // No red hard-blocker — the row fits within the booking's window.
      expect(screen.queryByText(/insufficient stock/i)).not.toBeInTheDocument();

      const trigger = screen.getByText("Checked out elsewhere");
      expect(trigger).toBeInTheDocument();
      // Amber (default `AvailabilityBadge` variant) — NOT the red variant.
      expect(trigger).toHaveClass("bg-warning-50");
      expect(trigger).toHaveClass("text-warning-700");

      // Tooltip explains the "expected back before this booking starts" logic.
      await userEvent.hover(trigger);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toMatch(/7 units/);
      expect(tooltip.textContent).toMatch(/only 3/);
      expect(tooltip.textContent).toMatch(
        /expected back before this booking starts/i
      );
    });

    it("does NOT render any stock badge for a row that is already checked out, even though bookedQuantity exceeds bookable", () => {
      // (d) — Regression guard for the "checked-out row showed Insufficient
      // stock" bug: this slice's own 22 booked units are all checked out
      // already (nothing returned yet), so `contextStatus` resolves to
      // CHECKED_OUT via the real `isBookingRowQtyFullyCheckedOut` branch.
      // Even though the workspace pool is critically low (bookable: 3), the
      // row's own checkout already happened — nothing to warn about for it.
      const qtRow = {
        ...qtCheckedOutAsset,
        status: "AVAILABLE",
        bookedQuantity: 22,
        checkedOutQuantity: 22,
        dispositionedQuantity: 0,
      } as unknown as AssetWithBooking;
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-ongoing-checked-out",
          status: "ONGOING",
          bookingAssets: [{ assetId: qtRow.id }],
          custodianUser: null,
        },
        availableUnitsByAsset: {
          [qtRow.id]: { bookable: 3, physicalNow: 3 },
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={qtRow}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(screen.queryByText(/insufficient stock/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText("Checked out elsewhere")
      ).not.toBeInTheDocument();
      // Confirms the row really did resolve to CHECKED_OUT (not silently
      // skipped for an unrelated reason).
      expect(assetStatusBadgeMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "CHECKED_OUT" })
      );
    });
  });

  // Per-slice QT checkout status. A QUANTITY_TRACKED asset can have multiple
  // BookingAsset slices on one booking (e.g. a kit-driven slice + a standalone
  // free-pool slice). Each row's badge must reflect THIS slice's own checkout
  // progress (`checkedOutQuantity` vs `bookedQuantity`), NOT the global
  // `Asset.status` — which only flips to CHECKED_OUT when EVERY slice is fully
  // out, so a single fully-checked-out slice would otherwise wrongly read
  // "Available". Mirrors the existing per-row check-IN completion handling.
  describe("QT per-slice checkout status", () => {
    const qtKitSliceRow = {
      ...baseAsset,
      id: "asset-qt-pencils",
      type: "QUANTITY_TRACKED",
      // Global status stays AVAILABLE: the parallel standalone slice is still
      // booked, so the asset-wide flip never fires. Mocked resolver returns
      // AVAILABLE (default) to model exactly that.
      status: "AVAILABLE",
      bookingAssetId: "ba-kit-slice",
      bookedQuantity: 22,
      dispositionedQuantity: 0,
    } as unknown as AssetWithBooking;

    it("shows CHECKED_OUT for a slice whose own units are all checked out, even though the global asset status is AVAILABLE", () => {
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-ongoing-qt",
          status: "ONGOING",
          bookingAssets: [{ assetId: qtKitSliceRow.id }],
          custodianUser: null,
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={
                  {
                    ...qtKitSliceRow,
                    // This slice's 22 booked units are all checked out; nothing
                    // returned yet.
                    checkedOutQuantity: 22,
                  } as unknown as AssetWithBooking
                }
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(assetStatusBadgeMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "CHECKED_OUT" })
      );
    });

    it("still shows the pending-return badge (not CHECKED_OUT) when only SOME of the slice's units are checked out", () => {
      mockUseLoaderData.mockReturnValue({
        booking: {
          id: "booking-ongoing-qt-partial",
          status: "ONGOING",
          bookingAssets: [{ assetId: qtKitSliceRow.id }],
          custodianUser: null,
        },
      });

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={
                  {
                    ...qtKitSliceRow,
                    // 10 of 22 out → partial, must NOT read as fully CHECKED_OUT.
                    checkedOutQuantity: 10,
                  } as unknown as AssetWithBooking
                }
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );

      expect(assetStatusBadgeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN",
        })
      );
    });
  });

  // Detached kit residue. Removing an asset from a kit nulls
  // `BookingAsset.assetKitId` (ON DELETE SET NULL) but a non-planning booking
  // KEEPS the slice, which then renders grouped under its original kit via
  // `sourceKitId`. The loader flags those rows with `isRemovedFromKit` so the
  // row can say so — otherwise it is indistinguishable from a live member.
  describe("removed-from-kit badge", () => {
    const finishedBooking = {
      booking: {
        id: "booking-complete",
        status: "COMPLETE",
        bookingAssets: [{ assetId: "asset-1" }],
        custodianUser: null,
      },
    };

    function renderRow(item: AssetWithBooking) {
      return render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={item}
                isKitAsset
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );
    }

    it("labels a detached slice and explains it in a keyboard-reachable tooltip", async () => {
      mockUseLoaderData.mockReturnValue(finishedBooking);

      renderRow({
        ...baseAsset,
        // Membership is gone (`assetKits: []`) but the loader resolved the
        // snapshot kit off `sourceKitId` and flagged the row.
        assetKits: [],
        isRemovedFromKit: true,
      } as unknown as AssetWithBooking);

      const trigger = screen.getByText("Removed from kit");
      expect(trigger).toBeInTheDocument();
      // Focusable trigger: the tooltip must not be hover-only (WCAG 2.1 AA).
      expect(trigger.tagName).toBe("BUTTON");

      await userEvent.hover(trigger);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toMatch(/removed from the kit/i);
      expect(tooltip.textContent).toMatch(/record of what was booked/i);
    });

    it("does NOT label a live kit member", () => {
      mockUseLoaderData.mockReturnValue(finishedBooking);

      renderRow({
        ...baseAsset,
        assetKits: [{ kitId: "kit-1", kit: { id: "kit-1", name: "Kit One" } }],
      } as unknown as AssetWithBooking);

      expect(screen.queryByText("Removed from kit")).not.toBeInTheDocument();
    });

    it("does NOT label a genuinely standalone asset", () => {
      mockUseLoaderData.mockReturnValue(finishedBooking);

      renderRow({
        ...baseAsset,
        assetKits: [],
      } as unknown as AssetWithBooking);

      expect(screen.queryByText("Removed from kit")).not.toBeInTheDocument();
    });
  });

  /**
   * The row's checkbox exists to feed the bulk actions menu, so it is offered
   * only when those roles have an action to take at this status. A checkbox
   * that can only ever feed an empty menu is dead UI.
   *
   * These assert the WIRING, which the hook's own tests cannot: they prove this
   * row reads `hasAny` at all. Without them the gate could be deleted outright
   * and every test here would still pass.
   */
  describe("bulk-selection checkbox", () => {
    const bookingAt = (status: string) => ({
      booking: {
        id: "booking-1",
        status,
        assets: [],
        custodianUser: { id: "user-1" },
      },
    });

    const renderAs = (
      status: string,
      roles: OrganizationRoles[] = [OrganizationRoles.BASE]
    ) => {
      const restricted =
        roles.includes(OrganizationRoles.BASE) ||
        roles.includes(OrganizationRoles.SELF_SERVICE);
      mockUseUserRoleHelper.mockReturnValue({
        isBase: roles.includes(OrganizationRoles.BASE),
        isSelfService: roles.includes(OrganizationRoles.SELF_SERVICE),
        isBaseOrSelfService: restricted,
        roles,
      });
      mockUseLoaderData.mockReturnValue(bookingAt(status));

      render(
        <table>
          <tbody>
            <tr>
              <ListAssetContent
                item={baseAsset}
                partialCheckinDetails={basePartialDetails}
                shouldShowCheckinColumns={false}
                partialCheckoutDetails={{}}
                shouldShowCheckoutColumns={false}
              />
            </tr>
          </tbody>
        </table>
      );
    };

    it("offers a checkbox to a BASE custodian on a DRAFT booking", () => {
      renderAs("DRAFT");

      expect(screen.getByTestId("bulk-checkbox")).toBeInTheDocument();
    });

    /**
     * The reported bug's surface: BASE may not remove past DRAFT and holds
     * neither check-in nor check-out, so there is nothing a selection could do.
     */
    it("withholds it from a BASE custodian once the booking is reserved", () => {
      renderAs("RESERVED");

      expect(screen.queryByTestId("bulk-checkbox")).not.toBeInTheDocument();
    });

    /**
     * Status is held constant and only the role varies, so the checkbox is the
     * single difference between the two renders — this row's other columns come
     * and go with status, which would otherwise swamp the comparison.
     */
    it("keeps the column aligned when the checkbox is withheld", () => {
      renderAs("RESERVED", [OrganizationRoles.ADMIN]);
      const withCheckbox = screen.getAllByRole("cell").length;

      cleanup();

      renderAs("RESERVED", [OrganizationRoles.BASE]);
      const withoutCheckbox = screen.getAllByRole("cell").length;

      // The fallback is an empty cell, not a missing one — dropping it would
      // shift every column in the table by one for exactly these roles.
      expect(withoutCheckbox).toBe(withCheckbox);
    });
  });
});
