import { action } from "~/routes/api+/mobile+/bookings.partial-checkout";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  // why: the route premium-gates with assertMobileCanUseBookings; mock it so
  // the gate is a no-op in these tests (mirrors the sibling booking tests).
  assertMobileCanUseBookings: vi.fn(),
  // why: the cross-user ownership guard resolves the caller's role through
  // this; mocking it is how each test picks SELF_SERVICE vs ADMIN.
  getMobileUserContext: vi.fn(),
}));

// why: external service — we mock the partial checkout to avoid database calls
// why: the route now loads creatorId/custodianUserId for the ownership guard;
// mock the org-scoped lookup rather than hitting a database.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

vi.mock("~/modules/booking/service.server", () => ({
  partialCheckoutBooking: vi.fn(),
}));

// why: we need to control error formatting in the catch block
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { partialCheckoutBooking } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

// Valid cuid-shaped IDs for fields the Zod schema validates as `.cuid()`
const assetCuid1 = "clxa1aaaa0000aaaaaaaaaaaa";
const assetCuid2 = "clxa2bbbb0000bbbbbbbbbbbb";

function createPartialCheckoutRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/bookings/partial-checkout?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/bookings/partial-checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    // Default: the caller owns the booking, so the ownership guard is a
    // no-op and the pre-existing cases still test what they were written for.
    (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });
    (db.booking.findFirst as any).mockResolvedValue({
      creatorId: "user-1",
      custodianUserId: null,
    });
  });

  it("accepts legacy { bookingId, assetIds } payload with INDIVIDUAL semantics", async () => {
    (partialCheckoutBooking as any).mockResolvedValue({
      checkedOutAssetCount: 2,
      remainingAssetCount: 3,
      isComplete: false,
      booking: {
        id: "booking-1",
        name: "Test Booking",
        status: "ONGOING",
      },
    });

    const request = createPartialCheckoutRequest({
      bookingId: "booking-1",
      // Schema validates ids as `.cuid()` — use the valid-cuid constants the
      // other tests in this file rely on. Loose strings ("a1") would fail
      // Zod and fall into the error path before reaching the service.
      assetIds: [assetCuid1, assetCuid2],
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.checkedOutCount).toBe(2);
    expect(body.remainingCount).toBe(3);
    expect(body.isComplete).toBe(false);
    expect(body.booking).toEqual({
      id: "booking-1",
      name: "Test Booking",
      status: "ONGOING",
    });

    expect(partialCheckoutBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: [assetCuid1, assetCuid2],
      // Legacy clients omit `checkouts` — service treats this as INDIVIDUAL.
      checkouts: undefined,
      userId: "user-1",
      hints: { timeZone: "UTC", locale: "en-US" },
    });
  });

  it("passes new { checkouts: [{ assetId, quantity }] } payload through to the service", async () => {
    (partialCheckoutBooking as any).mockResolvedValue({
      checkedOutAssetCount: 1,
      remainingAssetCount: 0,
      isComplete: true,
      booking: {
        id: "booking-1",
        name: "Test Booking",
        status: "ONGOING",
      },
    });

    const checkouts = [
      { assetId: assetCuid1, quantity: 2 },
      { assetId: assetCuid2, quantity: 1 },
    ];

    const request = createPartialCheckoutRequest({
      bookingId: "booking-1",
      // Schema still requires non-empty `assetIds`; clients send the parent set
      // alongside the per-asset `checkouts` array.
      assetIds: [assetCuid1, assetCuid2],
      checkouts,
      timeZone: "Europe/Berlin",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.isComplete).toBe(true);

    expect(partialCheckoutBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: [assetCuid1, assetCuid2],
      checkouts,
      userId: "user-1",
      // Body-supplied timeZone overrides the Accept-Language/cookie hints.
      hints: expect.objectContaining({ timeZone: "Europe/Berlin" }),
    });
  });

  it("returns 400 when Zod validation fails (quantity: -1)", async () => {
    (makeShelfError as any).mockImplementation((cause: any) => ({
      message: cause?.message ?? "Validation error",
      status: 400,
    }));

    const request = createPartialCheckoutRequest({
      bookingId: "booking-1",
      assetIds: [assetCuid1],
      checkouts: [{ assetId: assetCuid1, quantity: -1 }],
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(400);
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking is missing", async () => {
    const notFound = new Error("Booking not found") as Error & {
      status?: number;
    };
    notFound.status = 404;
    (partialCheckoutBooking as any).mockRejectedValue(notFound);
    (makeShelfError as any).mockReturnValue({
      message: "Booking not found",
      status: 404,
    });

    const request = createPartialCheckoutRequest({
      bookingId: "missing-booking",
      assetIds: ["a1"],
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Booking not found");
  });

  it("refuses a SELF_SERVICE user checking out someone else's booking", async () => {
    // SELF_SERVICE holds `booking:checkout`, so the role gate above passes for
    // ANY booking id in the organization. Only the ownership guard stops this.
    (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });
    (db.booking.findFirst as any).mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });

    const request = createPartialCheckoutRequest({
      bookingId: "booking-1",
      // cuid: the schema validates assetIds with z.string().cuid()
      assetIds: ["clx1a2b3c0000d4e5f6g7h8i9"],
    });
    await action(createActionArgs({ request }));

    // The assertion that matters: the checkout never happens.
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
  });

  it("still lets ADMIN check out a booking they do not own", async () => {
    // The guard is a no-op for ADMIN/OWNER — it must not break admin workflows.
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (db.booking.findFirst as any).mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });

    const request = createPartialCheckoutRequest({
      bookingId: "booking-1",
      // cuid: the schema validates assetIds with z.string().cuid()
      assetIds: ["clx1a2b3c0000d4e5f6g7h8i9"],
    });
    await action(createActionArgs({ request }));

    expect(partialCheckoutBooking).toHaveBeenCalled();
  });
});
