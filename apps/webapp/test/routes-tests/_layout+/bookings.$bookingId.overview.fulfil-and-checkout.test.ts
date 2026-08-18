/**
 * Web fulfil-and-checkout — permission mapping and cross-user guard.
 *
 * Two defects, both reachable by a direct POST that skips the loader:
 *
 *  1. The action gated on `PermissionAction.update`. BASE holds `update` and
 *     deliberately does NOT hold `checkout`, so a BASE user could check out
 *     through this route despite the role being denied that capability.
 *  2. The action had no ownership check at all — `canUserManageBookingAssets`
 *     runs only in the loader, and `fulfilModelRequestsAndCheckout` does not
 *     check ownership itself. So SELF_SERVICE, who legitimately holds
 *     `booking:checkout`, could check out anyone else's booking.
 *
 * detail.dev finding D017 — the web twin of D005.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout.tsx}
 */

import { OrganizationRoles } from "@prisma/client";

// why: mocking Remix's data() so the action's error path returns a Response
// whose status is assertable (React Router v7 single fetch).
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the permission gate is the first defect under test — mocking it lets
// each case choose the caller's role, and asserts which action was demanded.
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: the booking lookup feeding the ownership guard; avoids a database.
const { bookingFindUniqueOrThrow } = vi.hoisted(() => ({
  bookingFindUniqueOrThrow: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: { booking: { findUniqueOrThrow: bookingFindUniqueOrThrow } },
}));

// why: the sink we assert is never reached on a refused request.
const { fulfilMock } = vi.hoisted(() => ({ fulfilMock: vi.fn() }));
vi.mock("~/modules/booking/service.server", () => ({
  fulfilModelRequestsAndCheckout: fulfilMock,
  getBooking: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout";

// @vitest-environment node

/** POSTs to the action as a caller holding `roles`. */
function post({
  roles,
  creatorId = "someone-else",
  custodianUserId = "someone-else",
}: {
  roles: OrganizationRoles[];
  creatorId?: string;
  custodianUserId?: string;
}) {
  const role = roles[0];
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    role,
    isSelfServiceOrBase:
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE,
  });
  bookingFindUniqueOrThrow.mockResolvedValue({
    from: new Date("2026-01-01T09:00:00Z"),
    to: new Date("2026-01-02T09:00:00Z"),
    creatorId,
    custodianUserId,
  });

  return action({
    request: new Request(
      "https://app.shelf.nu/bookings/booking-1/overview/fulfil-and-checkout",
      {
        method: "POST",
        // react-zorm's parseFormAny wants bracket-index keys for arrays; a
        // repeated plain key collapses to a string and the schema 400s BEFORE
        // the guard, which would make the refusal assertions pass for the wrong
        // reason.
        body: new URLSearchParams({ "assetIds[0]": "asset-1" }),
      }
    ),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0]);
}

describe("fulfil-and-checkout action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("demands booking:checkout, not booking:update", async () => {
    await post({ roles: [OrganizationRoles.ADMIN] });

    // BASE holds `update` and not `checkout`; gating on `update` is exactly
    // what let a BASE user check out here.
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "checkout" })
    );
  });

  it("refuses a SELF_SERVICE user checking out someone else's booking", async () => {
    await post({ roles: [OrganizationRoles.SELF_SERVICE] });

    // The assertion that matters: the checkout never happens.
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it("allows a SELF_SERVICE user to check out their own booking", async () => {
    await post({
      roles: [OrganizationRoles.SELF_SERVICE],
      creatorId: "user-1",
      custodianUserId: "user-1",
    });

    expect(fulfilMock).toHaveBeenCalled();
  });

  it("leaves ADMIN able to check out a booking they do not own", async () => {
    await post({ roles: [OrganizationRoles.ADMIN] });

    expect(fulfilMock).toHaveBeenCalled();
  });
});
