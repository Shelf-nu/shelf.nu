/**
 * Kit row — bulk-selection gating.
 *
 * A kit row is the second of the three selection surfaces on the booking's
 * asset table, beside the asset rows and the select-all header. All three offer
 * a checkbox only when the acting roles have a bulk action to take at this
 * booking's status; a selection that can only ever feed an empty menu is dead
 * UI, and a column that gains or loses a cell shifts every column beside it.
 *
 * `useBookingBulkActions` is deliberately NOT mocked here. Its own tests cover
 * the rule; what these cover is that this row asks it — the half no amount of
 * hook testing can reach.
 *
 * @see {@link file://./kit-row.tsx}
 * @see {@link file://./../../hooks/use-booking-bulk-actions.ts}
 */
import type { ComponentProps, ReactNode } from "react";
import { BookingStatus, KitStatus, OrganizationRoles } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.overview.manage-assets";
import KitRow from "./kit-row";

const mockUseLoaderData = vi.fn();
const mockUseUserRoleHelper = vi.fn();

// why: the real hook reads the booking off route loader data, which needs a
// router context these component tests don't mount.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return { ...actual, useLoaderData: () => mockUseLoaderData() };
});

// why: each case picks the roles under test; the checkbox is gated on what
// those roles may do with a selection.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => mockUseUserRoleHelper(),
}));

// why: useCurrentOrganization reads route loader data under the hood; a minimal
// org shape keeps the code-badge resolver receiving valid input.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({
    barcodesEnabled: false,
    qrIdDisplayPreference: "QR_ID",
  }),
}));

// why: the checkbox under test — stubbed to a bare cell so its presence is
// observable without pulling in the selection atoms.
vi.mock("../list/bulk-actions/bulk-list-item-checkbox", () => ({
  default: () => <td data-testid="bulk-checkbox" />,
}));

// why: Button renders a react-router Link, which needs a router context these
// component tests deliberately don't mount.
vi.mock("../shared/button", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <a href="/test">{children}</a>
  ),
}));

// why: image rendering resolves signed URLs and is irrelevant to gating.
vi.mock("../kits/kit-image", () => ({ default: () => <div /> }));

// why: the row's own actions menu has separate gating and its own coverage.
vi.mock("./kit-row-actions-dropdown", () => ({ default: () => <td /> }));

// why: expanded rows render the asset list, which has its own test file.
vi.mock("./list-asset-content", () => ({ default: () => <tr /> }));

describe("KitRow bulk-selection checkbox", () => {
  // `status` is a KitStatus and the row reads only these fields; the cast keeps
  // the fixture to what the component actually touches.
  const kit = {
    id: "kit-1",
    name: "Camera Kit",
    image: null,
    imageExpiration: null,
    status: KitStatus.AVAILABLE,
    category: null,
    location: null,
    qrCodes: [],
    barcodes: [],
  } as ComponentProps<typeof KitRow>["kit"];

  const assets = [
    { id: "asset-1", title: "Camera", status: "AVAILABLE", bookings: [] },
  ] as unknown as AssetWithBooking[];

  const renderRow = (status: BookingStatus, roles: OrganizationRoles[]) => {
    mockUseUserRoleHelper.mockReturnValue({
      isBase: roles.includes(OrganizationRoles.BASE),
      isSelfService: roles.includes(OrganizationRoles.SELF_SERVICE),
      isBaseOrSelfService:
        roles.includes(OrganizationRoles.BASE) ||
        roles.includes(OrganizationRoles.SELF_SERVICE),
      roles,
    });
    mockUseLoaderData.mockReturnValue({
      booking: { id: "booking-1", status, assets: [], custodianUser: null },
    });

    render(
      <table>
        <tbody>
          <KitRow
            kit={kit}
            isExpanded={false}
            bookingStatus={status}
            bookingId="booking-1"
            assets={assets}
            partialCheckinDetails={{}}
            shouldShowCheckinColumns={false}
            partialCheckoutDetails={{}}
            shouldShowCheckoutColumns={false}
          />
        </tbody>
      </table>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers a checkbox to a BASE user on a DRAFT booking", () => {
    renderRow(BookingStatus.DRAFT, [OrganizationRoles.BASE]);

    expect(screen.getByTestId("bulk-checkbox")).toBeInTheDocument();
  });

  /**
   * BASE may not remove past DRAFT and holds neither check-in nor check-out, so
   * a selection here has nothing to feed. This row was the surface that kept
   * its checkbox after the asset rows lost theirs.
   */
  it("withholds it from a BASE user once the booking is reserved", () => {
    renderRow(BookingStatus.RESERVED, [OrganizationRoles.BASE]);

    expect(screen.queryByTestId("bulk-checkbox")).not.toBeInTheDocument();
  });

  it("keeps it for ADMIN on a live booking", () => {
    renderRow(BookingStatus.ONGOING, [OrganizationRoles.ADMIN]);

    expect(screen.getByTestId("bulk-checkbox")).toBeInTheDocument();
  });

  /**
   * Status is held constant and only the role varies, so the checkbox is the
   * single difference between the two renders — the row's other columns come
   * and go with status, which would otherwise swamp the comparison.
   */
  it("keeps the column aligned when the checkbox is withheld", () => {
    renderRow(BookingStatus.RESERVED, [OrganizationRoles.ADMIN]);
    const withCheckbox = screen.getAllByRole("cell").length;

    cleanup();

    renderRow(BookingStatus.RESERVED, [OrganizationRoles.BASE]);
    const withoutCheckbox = screen.getAllByRole("cell").length;

    // An empty cell, not a missing one: dropping it would shift every column
    // beside it for exactly the roles this gating targets.
    expect(withoutCheckbox).toBe(withCheckbox);
  });
});
