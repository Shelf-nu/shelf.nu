/**
 * Render tests for `ListBookingsContent` (the bookings-list row component),
 * focused on the two pills in the Assets column: amber "Stock conflict" and
 * "Includes unavailable assets".
 *
 * `ListBookingsContent` is shared by all five bookings-list surfaces, each of
 * which renders `<BookingsIndexPage />` and attaches both flags to every row
 * via `decorateBookingsForList` (`~/modules/booking/list-flags.server`). This
 * test exercises the render logic directly, so it covers all of them at once.
 *
 * The RULE behind `hasUnavailableAssets` — which assets count as unavailable,
 * and the quantity-tracked custody exemption — is a Prisma `where` now, and is
 * covered in `list-flags.server.test.ts`. What is left here is the wiring.
 *
 * Heavy/unrelated children (`BookingAssetsSidebar`, `TeamMemberBadge`,
 * `Button`, `DateS`) are mocked out — mirrors the isolation pattern in
 * `list-asset-content.test.tsx`. The `Badge` + `Tooltip` primitives that
 * actually render the pill are left real, since they're what this test
 * verifies.
 */
import type { ComponentProps, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    _count: { bookingAssets: 5 },
    hasStockConflict: false,
    hasUnavailableAssets: false,
    ...overrides,
  } as unknown as BookingItem;
}

describe("ListBookingsContent — Stock conflict pill", () => {
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

/**
 * The row used to decide this badge itself, by walking `item.bookingAssets`.
 * That array is no longer shipped with the list, so the decision moved to
 * `getBookingIdsWithUnavailableAssets` and the row just renders the flag.
 *
 * The rule it encodes — `availableToBook === false` counts for any asset,
 * while custody counts only for INDIVIDUAL assets, because a quantity-tracked
 * asset is a pool and 20 of 29 units on loan still leaves 9 bookable — is
 * covered in `list-flags.server.test.ts`. Getting that wrong flagged perfectly
 * valid quantity-tracked bookings, including one that had already checked out
 * successfully, which is why it has its own tests wherever it lives.
 */
describe("ListBookingsContent — 'Includes unavailable assets' badge", () => {
  const BADGE_TEXT = "Includes unavailable assets";

  /** Renders one row with the given flag value. */
  function renderRow(overrides: Partial<BookingItem> = {}) {
    render(
      <table>
        <tbody>
          <tr>
            <ListBookingsContent item={buildItem(overrides)} />
          </tr>
        </tbody>
      </table>
    );
  }

  it("renders the badge when the loader flagged the row", () => {
    renderRow({ hasUnavailableAssets: true } as Partial<BookingItem>);

    expect(screen.getByText(BADGE_TEXT)).toBeInTheDocument();
  });

  it("does NOT render the badge when the row is not flagged", () => {
    renderRow({ hasUnavailableAssets: false } as Partial<BookingItem>);

    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
  });

  it("does NOT render the badge for a loader that hasn't wired the flag", () => {
    renderRow({ hasUnavailableAssets: undefined } as Partial<BookingItem>);

    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
  });
});
