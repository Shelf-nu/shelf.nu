/**
 * POST /api/mobile/bookings/reserve: the caller's approval setting reaches the
 * reserve service.
 *
 * Whether a reservation becomes a pending approval request is decided inside
 * `reserveBooking` from the reserving member's
 * `access.policy.bookings.approvalSetting` and the workspace switches. The
 * route's only job here is to pass that setting through as
 * `actorApprovalSetting`, resolved from the caller's own roles by the real
 * policy table. A route that drops or hard-codes it would reserve a Base or
 * Self service member's booking straight past the approval gate.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.reserve.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";

// why: data() must return a real Response so the status and body are assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: external auth; each case picks the caller's roles through the context
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  assertMobileCanUseBookings: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: rate limiting is infrastructure, not under test
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

// why: the draft lookup and the user's stored format prefs come from the
// database; no database in tests
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));

// why: reserveBooking writes, emails and schedules; it is the sink whose input
// the route is judged on. getBookingFlags queries asset availability.
vi.mock("~/modules/booking/service.server", () => ({
  reserveBooking: vi.fn(),
  getBookingFlags: vi.fn(),
}));

// why: workspace settings come from the database; off and unlimited, so the
// shared reserve schema accepts the draft below
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn(),
}));
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  assertMobileCanUseBookings,
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import {
  getBookingFlags,
  reserveBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { action } from "~/routes/api+/mobile+/bookings.reserve";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

// @vitest-environment node

/** A future DRAFT booking with one asset, in custody of user-1. */
const DRAFT_BOOKING = {
  id: "booking-1",
  status: "DRAFT",
  name: "Camera kit",
  description: null,
  from: new Date("2030-06-03T09:00:00.000Z"),
  to: new Date("2030-06-03T17:00:00.000Z"),
  custodianUserId: "user-1",
  custodianTeamMemberId: "tm-1",
  custodianTeamMember: { id: "tm-1", name: "Member One", userId: "user-1" },
  tags: [],
  bookingAssets: [{ assetId: "asset-1" }],
  modelRequests: [],
};

/**
 * POSTs a reserve for booking-1 as user-1 in org-1.
 *
 * @returns The response status and parsed JSON body
 */
async function reserve() {
  const response = await (action({
    request: new Request(
      "http://localhost/api/mobile/bookings/reserve?orgId=org-1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer t",
        },
        body: JSON.stringify({ bookingId: "booking-1", timeZone: "UTC" }),
      }
    ),
    params: {},
    context: {},
  } as never) as unknown as Promise<Response>);
  return { status: response.status, body: await response.json() };
}

describe("POST /api/mobile/bookings/reserve forwards the caller's approval setting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);
    vi.mocked(assertMobileCanUseBookings).mockResolvedValue(undefined as never);
    vi.mocked(enforceUserRateLimit).mockResolvedValue(undefined as never);
    vi.mocked(db.booking.findFirst).mockResolvedValue(DRAFT_BOOKING as never);
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    vi.mocked(getBookingFlags).mockResolvedValue({
      hasAssets: true,
      hasModelRequests: false,
      hasUnavailableAssets: false,
    } as never);
    vi.mocked(getWorkingHoursForOrganization).mockResolvedValue({
      enabled: false,
      weeklySchedule: {},
      overrides: [],
    } as never);
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue({
      bufferStartTime: 0,
      maxBookingLength: null,
      maxBookingLengthSkipClosedDays: false,
    } as never);
    vi.mocked(reserveBooking).mockResolvedValue({
      id: "booking-1",
      name: "Camera kit",
      status: "RESERVED",
    } as never);
  });

  it.each([
    { role: OrganizationRoles.BASE, expected: "base" },
    { role: OrganizationRoles.SELF_SERVICE, expected: "selfService" },
    { role: OrganizationRoles.ADMIN, expected: "none" },
  ])(
    "passes actorApprovalSetting $expected for a $role caller",
    async ({ role, expected }) => {
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileUserContext({ roles: [role] }) as never
      );

      const { status } = await reserve();

      expect(status).toBe(200);
      expect(reserveBooking).toHaveBeenCalledTimes(1);
      expect(reserveBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "booking-1",
          organizationId: "org-1",
          userId: "user-1",
          actorApprovalSetting: expected,
        })
      );
    }
  );
});
