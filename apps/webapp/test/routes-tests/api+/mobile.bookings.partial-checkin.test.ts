import { action } from "~/routes/api+/mobile+/bookings.partial-checkin";
import { OrganizationRoles } from "@prisma/client";
import { createActionArgs } from "@mocks/remix";
import { mobileUserContext } from "@helpers/mobile-user-context";

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
  getMobileUserContext: vi.fn(),
  assertMobileCanUseBookings: vi.fn(),
}));

// why: external service — we mock partial checkin to avoid database calls
vi.mock("~/modules/booking/service.server", () => ({
  partialCheckinBooking: vi.fn(),
}));

// why: external database — the route does an org-scoped booking lookup
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: rate limiting hits a shared store; no-op it in tests
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

// Note: canPartialCheckInOut (~/utils/permissions/role-access) is
// intentionally NOT mocked: it is the real authorization gate, exercised via
// the booking status / role / custodian fixtures below.

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
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { partialCheckinBooking } from "~/modules/booking/service.server";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createPartialCheckinRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/bookings/partial-checkin?orgId=${orgId}`,
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

describe("POST /api/mobile/bookings/partial-checkin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations; reset the one some tests install
    // so it cannot answer a later test.
    vi.mocked(makeShelfError).mockReset();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (assertMobileCanUseBookings as any).mockResolvedValue(undefined);

    // Org-scoped booking lookup that feeds the eligibility check.
    (getMobileUserContext as any).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.OWNER] })
    );
    // ONGOING + OWNER => the real canPartialCheckInOut allows it: the
    // manage-items rule only blocks COMPLETE/ARCHIVED/CANCELLED for OWNER.
    (db.booking.findFirst as any).mockResolvedValue({
      id: "booking-1",
      status: "ONGOING",
      from: new Date(),
      to: new Date(),
      custodianUserId: "user-1",
    });
  });

  it("should partially checkin assets and return counts", async () => {
    (partialCheckinBooking as any).mockResolvedValue({
      checkedInAssetCount: 2,
      remainingAssetCount: 3,
      isComplete: false,
      booking: {
        id: "booking-1",
        name: "Test Booking",
        status: "ONGOING",
      },
    });

    const request = createPartialCheckinRequest({
      bookingId: "booking-1",
      assetIds: ["asset-1", "asset-2"],
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.checkedInCount).toBe(2);
    expect(body.remainingCount).toBe(3);
    expect(body.isComplete).toBe(false);
    expect(body.booking).toEqual({
      id: "booking-1",
      name: "Test Booking",
      status: "ONGOING",
    });

    expect(partialCheckinBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: ["asset-1", "asset-2"],
      userId: "user-1",
      hints: { timeZone: "UTC", locale: "en-US" },
    });
  });

  it("should return 403 when user lacks checkin permission", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);
    (makeShelfError as any).mockReturnValue({
      message: "Permission denied",
      status: 403,
    });

    const request = createPartialCheckinRequest({
      bookingId: "booking-1",
      assetIds: ["asset-1"],
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");

    expect(partialCheckinBooking).not.toHaveBeenCalled();
  });
  /**
   * Who may check in. The caller's `access` decides: a SELF_SERVICE custodian
   * may check in their own live booking, and a membership holding ADMIN beside
   * SELF_SERVICE is judged as ADMIN whatever order the roles are stored in.
   */
  describe("eligibility", () => {
    /** The booking under test, held by `custodianUserId`, in `status`. */
    function bookingIs(status: string, custodianUserId: string) {
      vi.mocked(db.booking.findFirst).mockResolvedValue({
        id: "booking-1",
        status,
        from: new Date(),
        to: new Date(),
        custodianUserId,
      } as never);
    }

    /** Posts a check-in as a caller holding `roles`. */
    async function postAs(roles: OrganizationRoles[]) {
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileUserContext({ roles })
      );
      vi.mocked(makeShelfError).mockImplementation(
        (cause) => cause as ReturnType<typeof makeShelfError>
      );
      vi.mocked(partialCheckinBooking).mockResolvedValue({
        checkedInAssetCount: 1,
        remainingAssetCount: 0,
        isComplete: true,
        booking: { id: "booking-1", name: "Test Booking", status: "COMPLETE" },
      } as never);

      const request = createPartialCheckinRequest({
        bookingId: "booking-1",
        assetIds: ["asset-1"],
      });
      return (await action(
        createActionArgs({ request })
      )) as unknown as Response;
    }

    it("lets a SELF_SERVICE custodian check in their own live booking", async () => {
      bookingIs("ONGOING", "user-1");

      await postAs([OrganizationRoles.SELF_SERVICE]);

      expect(partialCheckinBooking).toHaveBeenCalledTimes(1);
    });

    it("refuses SELF_SERVICE on someone else's live booking with a 403", async () => {
      bookingIs("ONGOING", "someone-else");

      const response = await postAs([OrganizationRoles.SELF_SERVICE]);

      expect(response.status).toBe(403);
      expect(partialCheckinBooking).not.toHaveBeenCalled();
    });

    it("lets a SELF_SERVICE-then-ADMIN membership check in someone else's live booking", async () => {
      bookingIs("ONGOING", "someone-else");

      await postAs([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

      expect(partialCheckinBooking).toHaveBeenCalledTimes(1);
    });
  });
});
