/**
 * Web partial check-out page: what a direct POST to its action, which skips the
 * loader, is held to before `checkoutAssets` runs.
 *
 * The page's guard runs in both loader and action:
 *  - SELF_SERVICE may check out only a booking they are the custodian of, while
 *    it is reserved, ongoing or overdue. Having created the booking is not
 *    enough, and the workspace toggle that lets them SEE other bookings does
 *    not let them check those out;
 *  - a refusal is a 403, not a 500.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.checkout-assets.tsx}
 */

import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import type { WorkspaceAccessSettings } from "~/utils/permissions/role-access";

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

const CALLER = "user-1";

/** POSTs a check-out as a caller with `roles` against a booking shaped by the rest. */
async function postCheckout({
  roles,
  workspace = {},
  status = "RESERVED",
  creatorId = "someone-else",
  custodianUserId = "someone-else",
}: {
  roles: OrganizationRoles[];
  workspace?: Partial<WorkspaceAccessSettings>;
  status?: string;
  creatorId?: string;
  custodianUserId?: string | null;
}) {
  requirePermissionMock.mockResolvedValue(
    permissionContext({ roles, workspace })
  );
  getBookingMock.mockResolvedValue({
    id: "booking-1",
    status,
    creatorId,
    custodianUserId,
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2099-01-02T09:00:00Z"),
  });
  checkoutAssetsMock.mockResolvedValue(new Response(null, { status: 204 }));

  return (await action({
    request: new Request(
      "https://app.shelf.nu/bookings/booking-1/overview/checkout-assets",
      { method: "POST", body: new URLSearchParams({ "assetIds[0]": "a-1" }) }
    ),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never)) as Response;
}

describe("checkout-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the page's batch as scanned on the web, leaving ticked rows to the form", async () => {
    // The page is the scanner: everything on it was scanned unless the drawer
    // named the slice in `selectedBookingAssetIds[]`, which the sink reads off
    // the form.
    await postCheckout({ roles: [OrganizationRoles.ADMIN] });

    expect(checkoutAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: { surface: "web", method: "scanned" },
      })
    );
  });

  it("refuses SELF_SERVICE on a booking they do not hold with a 403 and no check-out", async () => {
    const response = await postCheckout({
      roles: [OrganizationRoles.SELF_SERVICE],
    });

    expect(response.status).toBe(403);
    expect(checkoutAssetsMock).not.toHaveBeenCalled();
  });

  it("refuses SELF_SERVICE who created the booking but is not its custodian", async () => {
    const response = await postCheckout({
      roles: [OrganizationRoles.SELF_SERVICE],
      creatorId: CALLER,
    });

    expect(response.status).toBe(403);
    expect(checkoutAssetsMock).not.toHaveBeenCalled();
  });

  it("lets SELF_SERVICE check out a RESERVED booking they hold", async () => {
    await postCheckout({
      roles: [OrganizationRoles.SELF_SERVICE],
      custodianUserId: CALLER,
      status: "RESERVED",
    });

    expect(checkoutAssetsMock).toHaveBeenCalledTimes(1);
  });

  it("refuses SELF_SERVICE on someone else's live booking even with the see-toggle on", async () => {
    const response = await postCheckout({
      roles: [OrganizationRoles.SELF_SERVICE],
      workspace: { selfServiceCanSeeBookings: true },
      status: "ONGOING",
    });

    expect(response.status).toBe(403);
    expect(checkoutAssetsMock).not.toHaveBeenCalled();
  });

  it("lets ADMIN check out someone else's live booking", async () => {
    await postCheckout({
      roles: [OrganizationRoles.ADMIN],
      status: "ONGOING",
    });

    expect(checkoutAssetsMock).toHaveBeenCalledTimes(1);
  });
});
