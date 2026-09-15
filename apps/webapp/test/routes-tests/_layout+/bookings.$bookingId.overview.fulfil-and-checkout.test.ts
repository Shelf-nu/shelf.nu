/**
 * Web fulfil-and-checkout action — what a direct POST, which skips the loader,
 * is held to before `fulfilAndCheckOut` runs.
 *
 * Pins:
 *  - the permission demanded: `booking:checkout`, which BASE does not hold,
 *    rather than `booking:update`, which it does;
 *  - the ownership guard: SELF_SERVICE holds `booking:checkout` but may only
 *    check out a booking they created or are custodian of, and it runs before
 *    the workspace settings are read;
 *  - the `requireExplicitCheckout` flag handed to `fulfilAndCheckOut`;
 *  - a refused check-out reaching the user as an error notification.
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

// why: the permission gate is under test — mocking it lets each case choose
// the caller's role, and asserts which action was demanded.
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

// why: the loader's export; the action never calls it.
vi.mock("~/modules/booking/service.server", () => ({
  getBooking: vi.fn(),
}));

// why: the sink we assert is never reached on a refused request. The
// orchestrator has its own suite; this file pins what the action hands over.
const { fulfilMock } = vi.hoisted(() => ({ fulfilMock: vi.fn() }));
vi.mock("~/modules/booking/fulfil-and-checkout.server", () => ({
  fulfilAndCheckOut: fulfilMock,
}));

// why: the emitter pushes to a live SSE stream keyed to a real session; there
// is none in a route-level test. The mock records what the user is told.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const { bookingSettingsMock } = vi.hoisted(() => ({
  bookingSettingsMock: vi.fn(),
}));
// why: the explicit check-out rule reads the workspace settings; the hoisted
// mock above lets each case choose the switch state without a database.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: bookingSettingsMock,
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.fulfil-and-checkout";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";

// @vitest-environment node

/**
 * POSTs to the action as a caller holding `roles`. `requireExplicitCheckoutForAdmin`
 * sets the workspace switch the action reads; the decision itself is applied
 * by the service, so this file asserts what the action hands over.
 */
function post({
  roles,
  creatorId = "someone-else",
  custodianUserId = "someone-else",
  requireExplicitCheckoutForAdmin = false,
}: {
  roles: OrganizationRoles[];
  creatorId?: string;
  custodianUserId?: string;
  requireExplicitCheckoutForAdmin?: boolean;
}) {
  const role = roles[0];
  fulfilMock.mockResolvedValue({
    booking: { id: "booking-1", name: "Load-in", status: "ONGOING" },
    remainingAssetCount: 0,
  });
  bookingSettingsMock.mockResolvedValue(
    createBookingSettings({ requireExplicitCheckoutForAdmin })
  );
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

    // BASE holds `update` and not `checkout`; gating on `update` would let a
    // BASE user check out here.
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

  it("hands the service requireExplicitCheckout: true for an ADMIN when the Admin switch is on", async () => {
    await post({
      roles: [OrganizationRoles.ADMIN],
      requireExplicitCheckoutForAdmin: true,
    });

    expect(fulfilMock).toHaveBeenCalledTimes(1);
    expect(fulfilMock.mock.calls[0][0]).toMatchObject({
      assetIds: ["asset-1"],
      requireExplicitCheckout: true,
    });
  });

  it("hands the service requireExplicitCheckout: false when no switch applies", async () => {
    await post({ roles: [OrganizationRoles.ADMIN] });

    expect(fulfilMock.mock.calls[0][0]).toMatchObject({
      requireExplicitCheckout: false,
    });
    expect(bookingSettingsMock).toHaveBeenCalledWith("org-1");
  });

  it("checks ownership before it reads the workspace settings", async () => {
    // A SELF_SERVICE user on someone else's booking is refused first; the
    // explicit check-out rule is never consulted for a booking they cannot
    // touch, so a stale link answers with the ownership error, not policy.
    await post({
      roles: [OrganizationRoles.SELF_SERVICE],
      requireExplicitCheckoutForAdmin: true,
    });

    expect(fulfilMock).not.toHaveBeenCalled();
    expect(bookingSettingsMock).not.toHaveBeenCalled();
  });

  it("tells the user why a check-out was refused", async () => {
    const message =
      "Cannot check out — 1 × Dell still unassigned. The scanned units were assigned; scan the remaining reserved units to check out.";
    fulfilMock.mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        status: 400,
        label: "Booking",
        message,
        shouldBeCaptured: false,
      })
    );

    const result = await post({ roles: [OrganizationRoles.ADMIN] });

    expect((result as unknown as Response).status).toBe(400);
    // The drawer renders no action data, so this notification is the only
    // place the operator sees the refusal.
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        icon: { name: "x", variant: "error" },
        senderId: "user-1",
      })
    );
    expect(sendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Checked out" })
    );
  });
});
