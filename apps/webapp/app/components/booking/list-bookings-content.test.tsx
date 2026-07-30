/**
 * Render tests for `ListBookingsContent` (the bookings-list row component),
 * focused on the amber "Stock conflict" pill in the Assets column.
 *
 * `ListBookingsContent` is shared by both the main bookings index
 * (`bookings._index.tsx`) and the asset's Bookings tab
 * (`assets.$assetId.bookings.tsx`, which renders `<BookingsIndexPage />`) —
 * both loaders attach `hasStockConflict` to each row via
 * `getStockConflictedBookingIds` (`~/modules/booking/stock-conflicts.server`).
 * This test exercises the render logic directly, so it covers both surfaces
 * at once.
 *
 * Heavy/unrelated children (`BookingAssetsSidebar`, `TeamMemberBadge`,
 * `Button`, `DateS`) are mocked out — mirrors the isolation pattern in
 * `list-asset-content.test.tsx`. The `Badge` + `Tooltip` primitives that
 * actually render the pill are left real, since they're what this test
 * verifies.
 */
import type { ComponentProps, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseLoaderData = vi.fn();

// why: `ListBookingsContent` reads `dispositionedByBooking` /
// `dispositionBreakdownByBooking` / `checkedOutByBooking` off
// `useLoaderData()` for the sidebar's qty-progress display — irrelevant to
// the stock-conflict pill under test, so an empty object is sufficient.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => mockUseLoaderData(),
  };
});

// why: `to`-style Button renders react-router's `Link`, which needs a
// router context this render test doesn't set up. A plain anchor is enough
// to assert the booking name renders.
vi.mock("../shared/button", () => ({
  Button: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// why: the sidebar is a whole Radix `Sheet` drawer with its own asset-list
// rendering — unrelated to the pill this test verifies. A stub trigger is
// enough to prove it still renders alongside the pill.
vi.mock("./booking-assets-sidebar", () => ({
  BookingAssetsSidebar: () => <button type="button">assets sidebar</button>,
}));

// why: `TeamMemberBadge` needs `useCurrentOrganization` (throws outside a
// route/org context) purely to gate a "private" label — unrelated to the
// pill under test.
vi.mock("../user/team-member-badge", () => ({
  TeamMemberBadge: () => <span>custodian</span>,
}));

// why: `DateS` reads client-hint locale/timezone context not set up in this
// render test; the exact date formatting isn't what this test verifies.
vi.mock("../shared/date", () => ({
  DateS: ({ date }: { date: Date }) => <span>{String(date)}</span>,
}));

// why: `BookingStatusBadge` (kept REAL below) reads these two hooks; stub
// minimal values so it renders without needing a real auth/org context.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({
    isBase: false,
    isSelfService: false,
    isBaseOrSelfService: false,
    roles: [],
  }),
}));

import ListBookingsContent from "./list-bookings-content";

type BookingItem = ComponentProps<typeof ListBookingsContent>["item"];

/** Minimal booking row fixture — cast, mirrors `list-asset-content.test.tsx`'s `baseAsset` pattern. */
function buildItem(overrides: Partial<BookingItem> = {}): BookingItem {
  return {
    id: "booking-1",
    name: "Camera kit booking",
    status: "RESERVED",
    description: null,
    from: new Date("2026-08-01T09:00:00Z"),
    to: new Date("2026-08-05T17:00:00Z"),
    custodianUserId: null,
    custodianUser: null,
    custodianTeamMember: null,
    creator: {
      id: "user-1",
      firstName: "Jane",
      lastName: "Doe",
      displayName: null,
      profilePicture: null,
    },
    tags: [],
    modelRequests: [],
    bookingAssets: [
      {
        id: "ba-1",
        quantity: 5,
        assetKitId: null,
        asset: {
          id: "asset-1",
          title: "Widget",
          type: "QUANTITY_TRACKED",
          consumptionType: "STANDARD",
          availableToBook: true,
          custody: [],
          status: "AVAILABLE",
          mainImage: null,
          thumbnailImage: null,
          mainImageExpiration: null,
          sequentialId: null,
          preferredBarcodeId: null,
          qrCodes: [],
          barcodes: [],
          category: null,
          assetKits: [],
        },
      },
    ],
    hasStockConflict: false,
    ...overrides,
  } as unknown as BookingItem;
}

describe("ListBookingsContent — Stock conflict pill", () => {
  beforeEach(() => {
    // Reset the loader-data mock's return value for each test in this file.
    mockUseLoaderData.mockReturnValue({});
  });

  it('renders the amber "Stock conflict" pill when item.hasStockConflict is true', () => {
    render(
      <table>
        <tbody>
          <tr>
            <ListBookingsContent item={buildItem({ hasStockConflict: true })} />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText("Stock conflict")).toBeInTheDocument();
  });

  it("does NOT render the pill when item.hasStockConflict is false", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ListBookingsContent
              item={buildItem({ hasStockConflict: false })}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByText("Stock conflict")).not.toBeInTheDocument();
  });

  it("does NOT render the pill when item.hasStockConflict is undefined (loader that hasn't wired it)", () => {
    const item = buildItem();
    delete (item as { hasStockConflict?: boolean }).hasStockConflict;

    render(
      <table>
        <tbody>
          <tr>
            <ListBookingsContent item={item} />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByText("Stock conflict")).not.toBeInTheDocument();
  });

  it("still renders the assets sidebar trigger alongside the pill", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ListBookingsContent item={buildItem({ hasStockConflict: true })} />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByText("assets sidebar")).toBeInTheDocument();
    expect(screen.getByText("Stock conflict")).toBeInTheDocument();
  });
});
