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
import { createBookingSettings } from "@factories";

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

// why: React Router v7 single fetch — `data()` must return a real Response so
// the action's error path has an assertable status.
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
const { bookingFindUniqueOrThrow, modelRequestCount } = vi.hoisted(() => ({
  bookingFindUniqueOrThrow: vi.fn(),
  modelRequestCount: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findUniqueOrThrow: bookingFindUniqueOrThrow },
    bookingModelRequest: { count: modelRequestCount },
  },
}));

// why: the sink we assert is never reached on a refused request.
const { fulfilMock } = vi.hoisted(() => ({ fulfilMock: vi.fn() }));
vi.mock("~/modules/booking/service.server", () => ({
  fulfilModelRequestsAndCheckout: fulfilMock,
  getBooking: vi.fn(),
}));

// why: the emitter pushes to a live SSE stream keyed to a real session; there
// is none in a route-level test, and the notification is a side effect of the
// success path rather than anything these assertions inspect.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the explicit check-out rule reads the workspace settings; each case
// below chooses the switch state without a database.
const { bookingSettingsMock } = vi.hoisted(() => ({
  bookingSettingsMock: vi.fn(),
}));
// why: the explicit check-out rule reads the workspace settings; the hoisted
// mock above lets each case choose the switch state without a database.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: bookingSettingsMock,
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout";

// @vitest-environment node

/**
 * POSTs to the action as a caller holding `roles`. `scanned` decides whether
 * the body names a unit; a body without one is the zero-scan case the explicit
 * check-out rule refuses.
 */
function post({
  roles,
  creatorId = "someone-else",
  custodianUserId = "someone-else",
  scanned = true,
  openRequests = 0,
  requireExplicitCheckoutForAdmin = false,
}: {
  roles: OrganizationRoles[];
  creatorId?: string;
  custodianUserId?: string;
  scanned?: boolean | "junk-kit";
  openRequests?: number;
  requireExplicitCheckoutForAdmin?: boolean;
}) {
  const role = roles[0];
  bookingSettingsMock.mockResolvedValue(
    createBookingSettings({ requireExplicitCheckoutForAdmin })
  );
  modelRequestCount.mockResolvedValue(openRequests);
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
        body: new URLSearchParams(
          scanned === true
            ? { "assetIds[0]": "asset-1" }
            : scanned === "junk-kit"
            ? { "kitIds[0]": "" }
            : {}
        ),
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
    const result = await post({ roles: [OrganizationRoles.SELF_SERVICE] });

    // Assert the STATUS, not merely that the sink went uncalled: a refusal test
    // that only checks "not called" passes for any earlier failure — a bad
    // payload, a thrown mock — and would keep passing if the guard vanished but
    // something else broke first.
    expect((result as unknown as Response).status).toBe(403);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it("allows a SELF_SERVICE user who CREATED the booking", async () => {
    // Split from the custodian case: setting both fields to the caller tests
    // neither path on its own, so a guard checking only one would still pass.
    await post({
      roles: [OrganizationRoles.SELF_SERVICE],
      creatorId: "user-1",
      custodianUserId: "someone-else",
    });

    expect(fulfilMock).toHaveBeenCalled();
  });

  it("allows a SELF_SERVICE user who is the CUSTODIAN of the booking", async () => {
    await post({
      roles: [OrganizationRoles.SELF_SERVICE],
      creatorId: "someone-else",
      custodianUserId: "user-1",
    });

    expect(fulfilMock).toHaveBeenCalled();
  });

  it("leaves ADMIN able to check out a booking they do not own", async () => {
    await post({ roles: [OrganizationRoles.ADMIN] });

    expect(fulfilMock).toHaveBeenCalled();
  });

  it("refuses a request on a booking with no open model requests when explicit check-out is required", async () => {
    // With nothing left to fulfil, this route is the one-tap check-out under
    // another name, whatever the body names.
    const response = (await post({
      roles: [OrganizationRoles.ADMIN],
      scanned: false,
      requireExplicitCheckoutForAdmin: true,
    })) as unknown as Response;

    expect(response.status).toBe(403);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it("is not fooled by a body that names a blank kit id", async () => {
    const response = (await post({
      roles: [OrganizationRoles.ADMIN],
      scanned: "junk-kit",
      requireExplicitCheckoutForAdmin: true,
    })) as unknown as Response;

    expect(response.status).toBe(403);
    expect(fulfilMock).not.toHaveBeenCalled();
  });

  it("stays open while the booking still has model requests to fulfil", async () => {
    await post({
      roles: [OrganizationRoles.ADMIN],
      scanned: true,
      openRequests: 2,
      requireExplicitCheckoutForAdmin: true,
    });

    expect(fulfilMock).toHaveBeenCalledTimes(1);
    expect(fulfilMock.mock.calls[0][0]).toMatchObject({
      assetIds: ["asset-1"],
    });
  });

  it("lets the plain check-out through when explicit check-out is not required", async () => {
    await post({ roles: [OrganizationRoles.ADMIN], scanned: false });

    expect(fulfilMock).toHaveBeenCalledTimes(1);
    expect(bookingSettingsMock).toHaveBeenCalledWith("org-1");
  });
});
