/**
 * POST /api/mobile/bookings/create: the custodian self-lock a direct request
 * is held to, judged by the membership's effective role.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.create.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { mobileUserContext } from "@helpers/mobile-user-context";

// why: data() must return a real Response so the status is assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: external auth; each case picks the caller's roles through the context
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn().mockResolvedValue(undefined),
  assertMobileCanUseBookings: vi.fn().mockResolvedValue(undefined),
  getMobileUserContext: vi.fn(),
}));

// why: rate limiting is infrastructure, not under test
vi.mock("~/utils/rate-limit.server", () => ({ enforceUserRateLimit: vi.fn() }));

// why: `db.server` connects at import time; nothing here queries it
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the org-scoped custodian lookup feeds the guard under test
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi
    .fn()
    .mockResolvedValue({ id: "tm-2", name: "Other", userId: "someone-else" }),
}));

// why: the first step after the guard; failing it marks "the guard let this through"
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi
    .fn()
    .mockRejectedValue(new Error("past the custodian guard")),
}));
// why: imported at module load; the working-hours sentinel stops the action first
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: imported at module load; never reached in these cases
vi.mock("~/modules/booking/service.server", () => ({ createBooking: vi.fn() }));

import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { action } from "~/routes/api+/mobile+/bookings.create";

// @vitest-environment node

/**
 * Submits a booking whose custodian is another member, as a caller holding
 * `roles`.
 *
 * @param roles - Every role on the caller's membership
 * @returns The response status and parsed JSON body
 */
async function createForSomeoneElse(roles: OrganizationRoles[]) {
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles }) as never
  );
  const response = await (action({
    request: new Request(
      "http://localhost/api/mobile/bookings/create?orgId=org-1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer t",
        },
        body: JSON.stringify({
          name: "Booking",
          custodianTeamMemberId: "tm-2",
          startDate: "2099-01-01T09:00",
          endDate: "2099-01-01T17:00",
          timeZone: "UTC",
          assetIds: [],
          tags: [],
        }),
      }
    ),
    params: {},
    context: {},
  } as never) as unknown as Promise<Response>);
  return { status: response.status, body: await response.json() };
}

describe("POST /api/mobile/bookings/create: custodian self-lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses SELF_SERVICE booking for someone else", async () => {
    const { status, body } = await createForSomeoneElse([
      OrganizationRoles.SELF_SERVICE,
    ]);
    expect(status).toBe(403);
    expect(body.error.message).toMatch(/themselves only/);
  });

  it("lets a mixed [SELF_SERVICE, ADMIN] membership book for someone else", async () => {
    // The membership is judged by its highest role (ADMIN), not by the first
    // role listed.
    const { body } = await createForSomeoneElse([
      OrganizationRoles.SELF_SERVICE,
      OrganizationRoles.ADMIN,
    ]);
    // Passing the guard is proven by reaching the next step (the working-hours
    // sentinel), not by the absence of one error message.
    expect(getWorkingHoursForOrganization).toHaveBeenCalledTimes(1);
    expect(body.error?.message).not.toMatch(/themselves only/);
  });

  it("refuses SELF_SERVICE before the next step runs", async () => {
    await createForSomeoneElse([OrganizationRoles.SELF_SERVICE]);
    expect(getWorkingHoursForOrganization).not.toHaveBeenCalled();
  });
});
