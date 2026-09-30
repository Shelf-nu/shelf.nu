/**
 * Web partial check-in page — what a direct POST to its action, which skips the
 * loader, is held to before `checkinAssets` runs.
 *
 * Pins the check-in rule shared by the loader and the action:
 *  - SELF_SERVICE holds `booking:checkin`, but may check in only a booking they
 *    are the CUSTODIAN of, and only while it is ONGOING or OVERDUE. Having
 *    created the booking is not enough;
 *  - a refusal is a 403, not a 500;
 *  - ADMIN is not narrowed by ownership.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.checkin-assets.tsx}
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

// why: the booking lookup feeds the guard, and `checkinAssets` is the sink a
// refused request must never reach; both avoid a database
const { getBookingMock, checkinAssetsMock } = vi.hoisted(() => ({
  getBookingMock: vi.fn(),
  checkinAssetsMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  getBooking: getBookingMock,
  checkinAssets: checkinAssetsMock,
  attributeCategorizedDispositionsByBookingAsset: vi.fn(),
  getDetailedPartialCheckinData: vi.fn(),
}));

// why: loader-only helpers that would otherwise reach a database on import
vi.mock("~/modules/booking/utils.server", () => ({
  calculatePartialCheckinProgress: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({ db: {} }));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.checkin-assets";

// @vitest-environment node

const CALLER = "user-1";

/** POSTs a check-in as a caller with `role` against a booking shaped by the rest. */
async function postCheckin({
  role,
  status = "ONGOING",
  creatorId = "someone-else",
  custodianUserId = "someone-else",
}: {
  role: OrganizationRoles;
  status?: string;
  creatorId?: string;
  custodianUserId?: string | null;
}) {
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    role,
    userOrganizations: [],
  });
  getBookingMock.mockResolvedValue({
    id: "booking-1",
    status,
    creatorId,
    custodianUserId,
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2099-01-02T09:00:00Z"),
  });
  checkinAssetsMock.mockResolvedValue(new Response(null, { status: 204 }));

  return (await action({
    request: new Request(
      "https://app.shelf.nu/bookings/booking-1/overview/checkin-assets",
      { method: "POST", body: new URLSearchParams({ "assetIds[0]": "a-1" }) }
    ),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never)) as Response;
}

describe("checkin-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses SELF_SERVICE on a booking they neither created nor hold, with a 403 and no check-in", async () => {
    const response = await postCheckin({
      role: OrganizationRoles.SELF_SERVICE,
    });

    expect(response.status).toBe(403);
    expect(checkinAssetsMock).not.toHaveBeenCalled();
  });

  it("refuses SELF_SERVICE who created the booking but is not its custodian", async () => {
    const response = await postCheckin({
      role: OrganizationRoles.SELF_SERVICE,
      creatorId: CALLER,
    });

    expect(response.status).toBe(403);
    expect(checkinAssetsMock).not.toHaveBeenCalled();
  });

  it("refuses SELF_SERVICE custodian while the booking is not yet out", async () => {
    const response = await postCheckin({
      role: OrganizationRoles.SELF_SERVICE,
      custodianUserId: CALLER,
      status: "RESERVED",
    });

    expect(response.status).toBe(403);
    expect(checkinAssetsMock).not.toHaveBeenCalled();
  });

  it("lets SELF_SERVICE check in a live booking they are the custodian of", async () => {
    await postCheckin({
      role: OrganizationRoles.SELF_SERVICE,
      custodianUserId: CALLER,
      status: "OVERDUE",
    });

    expect(checkinAssetsMock).toHaveBeenCalledTimes(1);
  });

  it("lets ADMIN check in someone else's live booking", async () => {
    await postCheckin({ role: OrganizationRoles.ADMIN });

    expect(checkinAssetsMock).toHaveBeenCalledTimes(1);
  });
});
