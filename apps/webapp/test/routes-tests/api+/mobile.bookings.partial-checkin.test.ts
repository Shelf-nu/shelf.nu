import { action } from "~/routes/api+/mobile+/bookings.partial-checkin";
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
}));

// why: external service — we mock partial checkin to avoid database calls
vi.mock("~/modules/booking/service.server", () => ({
  partialCheckinBooking: vi.fn(),
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
} from "~/modules/api/mobile-auth.server";
import { partialCheckinBooking } from "~/modules/booking/service.server";
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

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
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
});
