/**
 * Web partial check-out page — the refusal a direct POST to its action gets.
 *
 * The page's guard (SELF_SERVICE may check out only a booking they are the
 * custodian of, while it is reserved, ongoing or overdue) runs in both loader
 * and action. A refusal must reach the caller as a 403, not a 500.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.checkout-assets.tsx}
 */

import { OrganizationRoles } from "@prisma/client";

// why: React Router v7 single fetch — `data()` must return a real Response so
// the action's error path has an assertable status.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: the permission gate is not under test; each case chooses the caller's role
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: the booking lookup feeds the guard, and `checkoutAssets` is the sink a
// refused request must never reach; both avoid a database
const { getBookingMock, checkoutAssetsMock } = vi.hoisted(() => ({
  getBookingMock: vi.fn(),
  checkoutAssetsMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  getBooking: getBookingMock,
  checkoutAssets: checkoutAssetsMock,
  computeBookingAssetRemainingToCheckOut: vi.fn(),
  computeBookingAssetSliceRemainingToCheckOut: vi.fn(),
  getDetailedPartialCheckoutData: vi.fn(),
  getPartiallyCheckedInAssetIds: vi.fn(),
}));

// why: loader-only database access on import
vi.mock("~/database/db.server", () => ({ db: {} }));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.checkout-assets";

// @vitest-environment node

describe("checkout-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses SELF_SERVICE on a booking they do not hold with a 403 and no check-out", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      userOrganizations: [],
    });
    getBookingMock.mockResolvedValue({
      id: "booking-1",
      status: "RESERVED",
      creatorId: "someone-else",
      custodianUserId: "someone-else",
      from: new Date("2026-01-01T09:00:00Z"),
      to: new Date("2099-01-02T09:00:00Z"),
    });

    const response = (await action({
      request: new Request(
        "https://app.shelf.nu/bookings/booking-1/overview/checkout-assets",
        { method: "POST", body: new URLSearchParams({ "assetIds[0]": "a-1" }) }
      ),
      params: { bookingId: "booking-1" },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as never)) as Response;

    expect(response.status).toBe(403);
    expect(checkoutAssetsMock).not.toHaveBeenCalled();
  });
});
